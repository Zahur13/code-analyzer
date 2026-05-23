import React, { useState, useEffect, useMemo, useCallback } from "react";
import axios from "axios";
import "./index.css";

const CODE_PARTICLES = [
  "const app = express();",
  'import React from "react";',
  "npm install --save",
  "function main() {}",
  'git commit -m "init"',
  '<div className="app">',
  "export default App;",
  'console.log("hello");',
  "return { success: true };",
  "#!/usr/bin/env node",
];

// Detect file extension from content
const detectExtension = (content) => {
  const trimmed = content.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html"))
    return ".html";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return ".json";
    } catch (e) {
      /* not json */
    }
  }
  if (trimmed.includes("import React") || trimmed.includes('from "react"'))
    return ".jsx";
  if (
    trimmed.includes("const ") ||
    trimmed.includes("let ") ||
    trimmed.includes("function ") ||
    trimmed.includes("=>")
  )
    return ".js";
  if (
    trimmed.startsWith("import ") ||
    trimmed.startsWith("def ") ||
    trimmed.startsWith("class ")
  )
    return ".py";
  if (
    trimmed.includes("body {") ||
    trimmed.includes("@media") ||
    trimmed.includes(".container")
  )
    return ".css";
  if (trimmed.startsWith("#!/bin/bash") || trimmed.startsWith("#!/bin/sh"))
    return ".sh";
  if (trimmed.startsWith("FROM ") && trimmed.includes("RUN ")) return "";
  return ".txt";
};

const PROJECT_TEMPLATE = [
  "backend/node_modules/.gitkeep",
  "backend/output/.gitkeep",
  "backend/uploads/.gitkeep",
  "backend/package.json",
  "backend/server.js",
  "backend/package-lock.json",
  "public/index.html",
  "public/favicon.ico",
  "src/App.js",
  "src/index.js",
  "src/index.css",
  "src/App.css",
  "tailwind.config.js",
  "postcss.config.js",
  "package.json",
];

const parseProjectTemplate = (text) => {
  const files = [];
  let detectedProjectName = null;
  const lines = text.split("\n");

  // 1. Detect Project Name
  const namePatterns = [
    /project_name\s*=\s*["']([^"']+)["']/,
    /^([a-zA-Z0-9_-]+)\/\s*$/m,
    /File Structure\s*\n\s*([a-zA-Z0-9_-]+)\//,
    /folder\s*name\s*[:=]\s*([a-zA-Z0-9_-]+)/i,
    /project\s*name\s*[:=]\s*([a-zA-Z0-9_-]+)/i,
    /"name"\s*:\s*"([^"]+)"/,
  ];
  for (const p of namePatterns) {
    const m = text.match(p);
    if (m) {
      detectedProjectName = m[1];
      break;
    }
  }

  // 2. Stateful Linear Scan for File/Folder Declarations
  const declarations = []; // { path, isFolder, lineIndex }
  const stack = []; // To track directory hierarchy: [ { level, path } ]

  const normalizePath = (p) => {
    let clean = p
      .trim()
      .replace(/^[├──|└──|│\s]+/, "")
      .replace(/\/+$/, "");
    if (detectedProjectName && clean.startsWith(detectedProjectName + "/")) {
      clean = clean.substring(detectedProjectName.length + 1);
    }
    return clean.replace(/^\/+/, "");
  };

  lines.forEach((line, i) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    // A. PRIORITY: Match explicit path formats (full paths)
    // This must happen before tree detection to avoid indented code being seen as a tree
    const otherRegexes = [
      /^\d+\.\s+([a-zA-Z0-9_./-]+\.[a-z0-9]+)/, // 1. src/App.js
      /^(?:\/\/|#)\s*file:\s*([a-zA-Z0-9_./-]+\.[a-z0-9]+)/i, // // file: src/App.js
      /^\*\*([a-zA-Z0-9_./-]+\.[a-z0-9]+)\*\*/, // **src/App.js**
      /"([a-zA-Z0-9_./-]+\.[a-z0-9]+)"\s*:/, // "src/App.js":
      /^([a-zA-Z0-9_./-]+\.[a-z0-9]+)$/i, // Plain path: src/App.js
      /^([a-zA-Z0-9_./-]+\/)$/, // Plain directory: src/
      /^[📁📄]\s*([a-zA-Z0-9_./-]+)/, // Emoji markers: 📄 src/App.js
      /^path[:=]\s*([a-zA-Z0-9_./-]+)/i, // path: src/App.js
      /^([a-zA-Z0-9_./-]+\.[a-z0-9]+)\s*[:=]\s*$/i, // src/App.js:
      /^#+\s+`?([a-zA-Z0-9_./-]+\.[a-z0-9]+)`?$/i, // ### `src/App.js`
      /^`([a-zA-Z0-9_./-]+\.[a-z0-9]+)`$/i, // `src/App.js`
    ];

    for (const reg of otherRegexes) {
      const m = trimmedLine.match(reg);
      if (m) {
        const p = normalizePath(m[1]);
        if (p) {
          declarations.push({ path: p, isFolder: false, lineIndex: i });
        }
        return;
      }
    }

    // B. Stateful Linear Scan for Tree-like Structure
    // Match indent/markers and then the name
    const treeMatch = line.match(/^([├──|└──|│\s]*)([a-zA-Z0-9_./-]+)/);

    // We consider it a tree line if it has markers OR if it's a directory
    const isTreeLine =
      treeMatch &&
      (trimmedLine.includes("├──") ||
        trimmedLine.includes("└──") ||
        trimmedLine.includes("│") ||
        trimmedLine.endsWith("/"));

    if (isTreeLine) {
      const markers = treeMatch[1];
      const name = treeMatch[2].trim();

      // Robust Level Calculation
      let level = 0;
      const markerChars = markers.split("");
      markerChars.forEach((c) => {
        if (c === "│") level += 1;
        else if (c === "├" || c === "└") level += 1;
        else if (c === "\t") level += 1;
      });
      // Fallback for space-only indentation (every 2-4 spaces = 1 level)
      if (level === 0 && markers.length > 0) {
        level = Math.max(1, Math.floor(markers.length / 2));
      }

      if (level > 5) return;

      const cleanName = name.replace(/\/$/, "");

      const nextLine = lines[i + 1] || "";
      const nextTreeMatch = nextLine.match(
        /^([├──|└──|│\s]*)([a-zA-Z0-9_./-]+)/,
      );
      const nextIndent = nextTreeMatch ? nextTreeMatch[1].length : 0;

      const isFolder =
        name.endsWith("/") ||
        line.includes("📁") ||
        (nextTreeMatch && nextIndent > markers.length);

      if (level === 0 && cleanName === detectedProjectName) return;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const parentPath = stack.map((s) => s.path).join("/");
      const fullPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;

      if (isFolder) {
        stack.push({ level, path: cleanName });
        declarations.push({ path: fullPath, isFolder: true, lineIndex: i });
      } else {
        declarations.push({ path: fullPath, isFolder: false, lineIndex: i });
      }
      return;
    }
  });

  // 3. Map Content and Synthesize Directories
  const fileMap = new Map(); // path -> { content, isFolder }

  const ensureParents = (filePath) => {
    const parts = filePath.split("/");
    if (parts.length > 1) {
      let currentPath = "";
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        if (!fileMap.has(currentPath)) {
          fileMap.set(currentPath, { content: null, isFolder: true });
        }
      }
    }
  };

  declarations.forEach((decl, i) => {
    const nextDecl = declarations[i + 1];
    const start = decl.lineIndex + 1;
    const end = nextDecl ? nextDecl.lineIndex : lines.length;

    // Use a more precise slice without aggressive trimming initially
    let chunk = lines.slice(start, end).join("\n");

    // Clean up specific artifacts but keep code structure
    chunk = chunk.replace(/^Copy\s*\n?/, "").replace(/\n?\s*Copy$/, "");

    // Ignore noise chunks that look like re-printed tree structures
    // BUT only if they don't contain actual code indicators
    const isTreeNoise =
      chunk.match(/^[├──|└──|│]/m) &&
      !chunk.includes("import ") &&
      !chunk.includes("const ") &&
      !chunk.includes("def ") &&
      !chunk.includes("function ") &&
      !chunk.includes("class ");

    if (isTreeNoise) {
      chunk = "";
    }

    const fenceMatch = chunk.match(/```[a-z]*\n([\s\S]*?)\n```/);
    if (fenceMatch) {
      chunk = fenceMatch[1];
    } else {
      // Fallback: strip leading and trailing fences line-by-line if full match fails
      chunk = chunk
        .replace(/^```[a-z]*\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
    }

    ensureParents(decl.path);

    if (decl.isFolder) {
      if (!fileMap.has(decl.path))
        fileMap.set(decl.path, { content: null, isFolder: true });
    } else {
      const existing = fileMap.get(decl.path);
      // If we already have content, only append if this chunk is substantial
      // or if it's the first time we're seeing this file
      const trimmedChunk = chunk.trim();
      if (!existing || trimmedChunk.length > 0) {
        // If file exists, we merge carefully or replace if this is a better match
        const currentContent = existing ? existing.content : "";
        // If the new chunk starts with common code markers, it's likely the "real" content
        const isBetterMatch =
          trimmedChunk.length > currentContent.length ||
          (trimmedChunk.includes("import ") &&
            !currentContent.includes("import "));

        if (!existing || isBetterMatch) {
          fileMap.set(decl.path, { content: chunk, isFolder: false });
        }
      }
    }
  });

  // 4. Build final file list
  fileMap.forEach((val, path) => {
    if (val.isFolder) {
      // Don't add .gitkeep files for empty folders as requested
    } else {
      files.push({ path, content: val.content || "" });
    }
  });

  // Generic fallback
  if (files.length === 0) {
    const mdBlocks = text.match(/```[a-z]*\n([\s\S]*?)\n```/g) || [];
    mdBlocks.forEach((block, i) => {
      const content = block.replace(/```[a-z]*\n|```/g, "").trim();
      files.push({ path: `file_${i + 1}.txt`, content });
    });
  }

  return { files, detectedProjectName };
};

const INPUT_MODES = [
  {
    id: "smart",
    label: "🔍 Smart Parse",
    desc: "Auto-detect Python dicts, Markdown, delimiters",
  },
  {
    id: "raw",
    label: "📝 Raw Text",
    desc: "Paste raw code → converts to a downloadable file",
  },
  {
    id: "formatter",
    label: "🐍 Python Formatter",
    desc: "Analyses code word-by-word and organizes into a structured project",
  },
];

const formatPythonCode = (text) => {
  if (!text) return "";

  // Advanced tokenization: strings, comments, keywords, symbols
  // Order matters: strings and comments first to avoid breaking them
  const tokens =
    text.match(
      /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|[a-zA-Z_][a-zA-Z0-9_]*|[0-9]+|[:()[\]{},.+\-*\/=<>!&|^%]+|\n|\s+/g,
    ) || [];

  let result = "";
  let indentLevel = 0;
  let atStartOfLine = true;

  const keywordsRequiringIndent = [
    "def",
    "class",
    "if",
    "for",
    "while",
    "try",
    "with",
    "elif",
    "else",
    "except",
    "finally",
  ];
  const keywordsDecreasingIndent = ["elif", "else", "except", "finally"];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const trimmed = token.trim();

    if (token === "\n") {
      result += "\n";
      atStartOfLine = true;
      continue;
    }

    if (!trimmed) continue;

    // Handle indentation decrease for certain keywords
    if (atStartOfLine && keywordsDecreasingIndent.includes(trimmed)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    if (atStartOfLine) {
      result += "    ".repeat(indentLevel);
      atStartOfLine = false;
    } else {
      // Add space between tokens if needed
      const lastChar = result.slice(-1);
      const isSymbol = /[:()[\]{},.+\-*\/=<>!&|^%]/.test(trimmed);
      const lastWasSymbol = /[:()[\]{},.+\-*\/=<>!&|^%]/.test(lastChar);

      if (lastChar && lastChar !== " " && lastChar !== "\n") {
        // Space logic:
        // - Space after comma
        // - Space around operators
        // - No space before ( or [ or {
        // - No space after ( or [ or {
        if (lastChar === ",") result += " ";
        else if (isSymbol || lastWasSymbol) {
          // Exceptions for symbols that don't need spaces
          const noSpaceBefore = [":", "(", "[", "{", ")", "]", "}", ",", "."];
          const noSpaceAfter = ["(", "[", "{", "."];

          if (
            !noSpaceBefore.includes(trimmed) &&
            !noSpaceAfter.includes(lastChar)
          ) {
            result += " ";
          }
        } else {
          result += " ";
        }
      }
    }

    result += trimmed;

    // Handle indentation increase after colon
    if (trimmed === ":") {
      let hasNewline = false;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j] === "\n") {
          hasNewline = true;
          break;
        }
        if (tokens[j].trim()) break;
      }
      if (hasNewline) {
        indentLevel++;
      }
    }

    // Decrease indent logic: if we just finished a line and the next line is not indented?
    // In a "word by word" formatter, we have to make guesses.
    // If we see a keyword that usually ends a block?
    // Actually, in Python, indentation is the only way to know.
    // If the input is plain text WITHOUT indentation, we can only guess based on keywords.
  }

  return result.trim();
};

// Component to render tree recursively
const RenderTree = ({ node, level = 0, selectedFile, setSelectedFile }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (!node.isFolder) {
    const isSelected = selectedFile && selectedFile.path === node.path;
    return (
      <div
        className={`file-item ${isSelected ? "active" : ""}`}
        style={{
          paddingLeft: `calc(${level} * var(--tree-indent, 16px) + 12px)`,
        }}
        onClick={() => setSelectedFile(node)}
      >
        <span className="file-icon">📄</span>
        <span>{node.name}</span>
      </div>
    );
  }

  return (
    <div className="folder-group">
      <div
        className="folder-name"
        style={{
          paddingLeft: `calc(${level} * var(--tree-indent, 16px) + 12px)`,
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="folder-icon">{isOpen ? "📂" : "📁"}</span>
        {node.name}
      </div>
      {isOpen &&
        Object.values(node.children || {})
          .sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
          })
          .map((child) => (
            <RenderTree
              key={child.path || child.name}
              node={child}
              level={level + 1}
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
            />
          ))}
    </div>
  );
};

const App = () => {
  const [inputText, setInputText] = useState("");
  const [parsedFiles, setParsedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [zipName, setZipName] = useState("code-analyzer");
  const [statusMsg, setStatusMsg] = useState(null);
  const [inputMode, setInputMode] = useState("smart");
  const [rawFileName, setRawFileName] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [pythonScript, setPythonScript] = useState("");

  // Function to generate the Python Formatter Script
  const generatePythonScript = useCallback((files, projectName) => {
    const filesDict = {};
    files.forEach((f) => {
      filesDict[f.path] = f.content;
    });

    const script = `import os
import zipfile
from pathlib import Path

# =========================
# Desktop Path
# =========================
desktop_path = Path.home() / "Desktop"

# Project Folder
project_name = "${projectName || "project"}"
project_path = desktop_path / project_name

# =========================
# File Structure & Content
# =========================
files = {
${Object.entries(filesDict)
  .map(
    ([path, content]) =>
      `    "${path}": """${content.replace(/"""/g, '\\"\\"\\""')}""",`,
  )
  .join("\n\n")}
}

# =========================
# Create Files & Folders
# =========================
print(f"Creating project: {project_name}...")
for file_path, content in files.items():
    full_path = project_path / file_path

    # Create folder if not exists
    full_path.parent.mkdir(parents=True, exist_ok=True)

    # Write content
    with open(full_path, "w", encoding="utf-8") as file:
        file.write(content)

# =========================
# Create ZIP File
# =========================
zip_path = desktop_path / f"{project_name}.zip"

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, filenames in os.walk(project_path):
        for filename in filenames:
            file_full_path = os.path.join(root, filename)

            # Keep folder structure inside zip
            arcname = os.path.relpath(file_full_path, project_path.parent)

            zipf.write(file_full_path, arcname)

print(f"\\n==========================================")
print(f"SUCCESS!")
print(f"Project created at: {project_path}")
print(f"ZIP file created at: {zip_path}")
print(f"==========================================")
`;
    return script;
  }, []);

  // Sync zipName and generate script in formatter mode
  useEffect(() => {
    if (inputMode === "formatter") {
      if (!inputText.trim()) {
        setZipName("code-analyzer");
      }

      if (parsedFiles.length > 0) {
        setPythonScript(generatePythonScript(parsedFiles, zipName));
      } else {
        setPythonScript("");
      }
    } else {
      setPythonScript("");
    }
  }, [inputMode, inputText, parsedFiles, zipName, generatePythonScript]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      darkMode ? "dark" : "light",
    );
  }, [darkMode]);

  // Smart Parser Function
  const parseTextSmart = useCallback((text) => {
    const extractedFiles = [];
    const addFile = (path, content) => {
      const cleanPath = path.trim();
      if (!cleanPath) return;
      if (!extractedFiles.find((f) => f.path === cleanPath)) {
        extractedFiles.push({ path: cleanPath, content });
      }
    };

    try {
      const pythonTripleRegex = /"([^"]+)"\s*:\s*"""([\s\S]*?)"""/g;
      let match;
      while ((match = pythonTripleRegex.exec(text)) !== null)
        addFile(match[1], match[2]);

      const pythonSingleTripleRegex = /'([^']+)'\s*:\s*'''([\s\S]*?)'''/g;
      while ((match = pythonSingleTripleRegex.exec(text)) !== null)
        addFile(match[1], match[2]);

      let strippedText = text
        .replace(/"""[\s\S]*?"""/g, "")
        .replace(/'''[\s\S]*?'''/g, "");
      const pythonEmptyRegex = /"([^"]+)"\s*:\s*""(?!")/g;
      while ((match = pythonEmptyRegex.exec(strippedText)) !== null)
        addFile(match[1], "");

      const markdownRegex = /\*\*(.*?)\*\*\s*```[a-z]*\n([\s\S]*?)```/g;
      while ((match = markdownRegex.exec(text)) !== null)
        addFile(match[1], match[2]);

      const markdownAltRegex = /`(.*?)`\s*```[a-z]*\n([\s\S]*?)```/g;
      while ((match = markdownAltRegex.exec(text)) !== null)
        addFile(match[1], match[2]);

      const delimiterRegex =
        /====\s*(.*?)\s*====\n([\s\S]*?)(?====\s*.*?\s*====|$)/g;
      while ((match = delimiterRegex.exec(text)) !== null)
        addFile(match[1], match[2].trim());

      const fileDashedRegex = /File:\s*(.*?)\s*\n----\n([\s\S]*?)\n----/g;
      while ((match = fileDashedRegex.exec(text)) !== null)
        addFile(match[1], match[2]);

      const commentFileRegex =
        /(?:\/\/|#)\s*file:\s*(.*?)\s*\n([\s\S]*?)(?=(?:\/\/|#)\s*file:\s*|$)/gi;
      while ((match = commentFileRegex.exec(text)) !== null)
        addFile(match[1], match[2].trim());

      const dashDelimRegex =
        /---\s+([\w./\\-]+\.\w+)\s+---\n([\s\S]*?)(?=---\s+[\w./\\-]+\.\w+\s+---|$)/g;
      while ((match = dashDelimRegex.exec(text)) !== null)
        addFile(match[1], match[2].trim());
    } catch (e) {
      console.error("Parse error:", e);
    }
    return extractedFiles;
  }, []);

  // Raw text parser
  const parseTextRaw = useCallback((text, fileName) => {
    if (!text.trim()) return [];
    const commentFileRegex =
      /(?:\/\/|#)\s*file:\s*(.*?)\s*\n([\s\S]*?)(?=(?:\/\/|#)\s*file:\s*|$)/gi;
    const multiFiles = [];
    let match;
    while ((match = commentFileRegex.exec(text)) !== null) {
      multiFiles.push({ path: match[1].trim(), content: match[2].trim() });
    }
    if (multiFiles.length > 0) return multiFiles;
    const name = fileName.trim() || `code${detectExtension(text)}`;
    return [{ path: name, content: text }];
  }, []);

  // Auto-parse on text/mode change
  useEffect(() => {
    let files;
    if (inputMode === "smart") {
      files = parseTextSmart(inputText);
    } else if (inputMode === "raw") {
      files = parseTextRaw(inputText, rawFileName);
    } else if (inputMode === "formatter") {
      // Use the smart template parser to organize into dynamic structure
      const { files: parsed, detectedProjectName } =
        parseProjectTemplate(inputText);

      files = parsed.map((f) => ({
        ...f,
        content: f.path.endsWith(".py")
          ? formatPythonCode(f.content)
          : f.content,
      }));

      // Update zip name if a project name was detected
      if (detectedProjectName) {
        setZipName(detectedProjectName);
      }
    } else {
      files = [];
    }
    setParsedFiles(files);

    // Reset selected file if it's no longer in the list
    if (selectedFile && !files.find((f) => f.path === selectedFile.path)) {
      setSelectedFile(null);
    }

    if (files.length > 0) {
      setStatusMsg({
        type: "info",
        text: `${files.length} file${files.length > 1 ? "s" : ""} detected`,
      });
    } else if (inputText.trim()) {
      setStatusMsg({
        type: "error",
        text:
          inputMode === "smart"
            ? "No files detected. Try a different format or switch mode."
            : "Enter some text to create a file.",
      });
    } else {
      setStatusMsg(null);
    }
  }, [inputText, inputMode, rawFileName, parseTextSmart, parseTextRaw]);

  // Recursive File Tree Structure
  const fileTree = useMemo(() => {
    const root = { name: zipName || "project", children: {}, isFolder: true };

    parsedFiles.forEach((file) => {
      if (!file.path) return;

      // Filter out empty parts and normalize path
      const parts = file.path.split("/").filter((p) => p.trim() !== "");
      let current = root;

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;

        if (isLast) {
          // It's a file
          current.children[part] = {
            name: part,
            path: file.path,
            isFolder: false,
            content: file.content,
          };
        } else {
          // It's a folder - ensure we don't overwrite a file with a folder
          if (!current.children[part] || !current.children[part].isFolder) {
            current.children[part] = {
              name: part,
              children: {},
              isFolder: true,
            };
          }
          current = current.children[part];
        }
      });
    });
    return root;
  }, [parsedFiles, zipName]);

  // Copy formatted output
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  // Download handler
  const handleDownload = async () => {
    if (parsedFiles.length === 0) return;
    setLoading(true);
    setStatusMsg({ type: "info", text: "Generating ZIP..." });

    try {
      // Prepend the root folder name to every path to match requested structure
      const rootFolderName = (zipName || "code-analyzer").trim();
      const filesWithRoot = parsedFiles.map((f) => {
        // Normalize path: remove leading/trailing slashes and double slashes
        const cleanPath = f.path
          .split("/")
          .filter((p) => p.trim() !== "")
          .join("/");
        return {
          ...f,
          path: `${rootFolderName}/${cleanPath}`,
        };
      });

      const response = await axios.post(
        "http://localhost:5001/create-zip",
        { files: filesWithRoot },
        { responseType: "blob" },
      );

      const blob = new Blob([response.data], { type: "application/zip" });
      const fileName = `${zipName || "project"}.zip`;

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: "ZIP Archive",
                accept: { "application/zip": [".zip"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setStatusMsg({
            type: "success",
            text: `Saved ${fileName} successfully!`,
          });
          setLoading(false);
          return;
        } catch (pickerErr) {
          if (pickerErr.name === "AbortError") {
            setStatusMsg(null);
            setLoading(false);
            return;
          }
        }
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatusMsg({ type: "success", text: `Downloaded ${fileName}!` });
    } catch (error) {
      console.error("Error downloading:", error);
      setStatusMsg({
        type: "error",
        text: "Failed to generate ZIP. Is the backend running?",
      });
    }
    setLoading(false);
  };

  return (
    <>
      {/* Animated Background */}
      <div className="app-background">
        {CODE_PARTICLES.map((code, i) => (
          <span
            key={i}
            className="particle"
            style={{
              left: `${i * 10 + 2}%`,
              animationDuration: `${18 + i * 3}s`,
              animationDelay: `${i * 2}s`,
              fontSize: `${12 + (i % 3) * 2}px`,
            }}
          >
            {code}
          </span>
        ))}
      </div>

      {/* Main App */}
      <div className="app-container">
        {/* Header */}
        <header className="app-header">
          <div className="app-title">
            <div className="logo-icon">⚡</div>
            <div>
              <h1>Code → ZIP</h1>
              <p className="app-subtitle">
                Paste code, preview structure, download as ZIP
              </p>
            </div>
          </div>
          <button
            className="theme-toggle"
            onClick={() => setDarkMode(!darkMode)}
          >
            {darkMode ? "☀️" : "🌙"} {darkMode ? "Light" : "Dark"}
          </button>
        </header>

        {/* Main Layout */}
        <div className="main-layout">
          {/* Left: Editor */}
          <div className="glass-panel editor-panel">
            {/* Mode Tabs */}
            <div className="mode-tabs">
              {INPUT_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`mode-tab ${inputMode === mode.id ? "active" : ""}`}
                  onClick={() => setInputMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <p className="panel-desc">
              {INPUT_MODES.find((m) => m.id === inputMode)?.desc}
            </p>

            {/* Raw mode: filename input */}
            {inputMode === "raw" && (
              <input
                className="raw-filename-input"
                type="text"
                value={rawFileName}
                onChange={(e) => setRawFileName(e.target.value)}
                placeholder="File path (e.g. src/App.js) — or leave empty for auto-detect"
              />
            )}

            {statusMsg && (
              <div className={`status-bar ${statusMsg.type}`}>
                <span>
                  {statusMsg.type === "success"
                    ? "✅"
                    : statusMsg.type === "error"
                      ? "⚠️"
                      : "ℹ️"}
                </span>
                <span>{statusMsg.text}</span>
              </div>
            )}

            <textarea
              className="code-textarea"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                inputMode === "smart"
                  ? `Paste formatted code here...\n\nSupported formats:\n\n─── Python Dictionary ───\n"src/App.js": """const App = () => {};"""\n\n─── Markdown ───\n**src/App.js**\n\`\`\`javascript\nconst App = () => {};\n\`\`\`\n\n─── Delimiters ───\n==== src/App.js ====\nconst App = () => {};`
                  : inputMode === "formatter"
                    ? `Paste code here to organize into code-analyzer structure...\n\nWe'll automatically detect and place:\n- Express/Multer code → backend/server.js\n- React/JSX code → src/App.js\n- CSS/Tailwind → src/index.css\n- Config files → tailwind.config.js, etc.\n\nYou can also use markers:\n# file: my_script.py\nprint("hello")`
                    : `Paste any raw code here...\n\nIt will be saved as a single file.\nSet the filename above, or leave it empty\nand we'll auto-detect the type.\n\n─── Multi-file tip ───\n// file: src/index.js\nconsole.log("hello");\n\n// file: src/utils.js\nexport const add = (a, b) => a + b;`
              }
            />

            {/* Auto mode: formatted output */}
            {inputMode === "auto" && formattedOutput && (
              <div className="formatted-output-section">
                <div className="formatted-output-header">
                  <span className="formatted-output-title">
                    📋 Formatted Output
                  </span>
                  <button className="copy-btn" onClick={handleCopy}>
                    {copied ? "✅ Copied!" : "📋 Copy"}
                  </button>
                </div>
                <textarea
                  className="code-textarea formatted-output"
                  value={formattedOutput}
                  readOnly
                />
              </div>
            )}
          </div>

          {/* Right: Preview + Download */}
          <div className="glass-panel sidebar-panel">
            <div className="sidebar-header">
              <h2>📁 File Structure</h2>
              <span className="file-count-badge">
                {parsedFiles.length} files
              </span>
            </div>

            {/* Master Mode Output (Preview + Script) */}
            {inputMode === "formatter" && parsedFiles.length > 0 && (
              <div className="master-mode-output">
                <div className="master-section">
                  <div className="master-header">
                    <h3>PROJECT PREVIEW</h3>
                  </div>
                  <div className="file-tree master-tree">
                    <RenderTree
                      node={fileTree}
                      selectedFile={selectedFile}
                      setSelectedFile={setSelectedFile}
                    />
                  </div>
                </div>

                <div className="master-section">
                  <div className="master-header">
                    <h3>COMPLETE PYTHON FORMATTER SCRIPT</h3>
                  </div>
                  <div className="python-script-container glass-panel">
                    <div className="script-header">
                      <span>formatter.py</span>
                      <button
                        className="copy-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(pythonScript);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? "✅ Copied!" : "📋 Copy Script"}
                      </button>
                    </div>
                    <pre className="script-content">
                      <code>{pythonScript}</code>
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* Default File Tree (hidden in formatter mode if we want strict master layout) */}
            {inputMode !== "formatter" && (
              <div className="file-tree">
                {parsedFiles.length === 0 ? (
                  <div className="file-tree-empty">
                    <span className="empty-icon">📂</span>
                    <span>No files detected yet</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>
                      Paste code on the left to see the structure
                    </span>
                  </div>
                ) : (
                  <RenderTree
                    node={fileTree}
                    selectedFile={selectedFile}
                    setSelectedFile={setSelectedFile}
                  />
                )}
              </div>
            )}

            {/* File Preview Section */}
            {selectedFile && (
              <>
                <div
                  className="preview-overlay"
                  onClick={() => setSelectedFile(null)}
                />
                <div className="file-preview-panel glass-panel">
                  <div className="preview-header">
                    <div className="preview-info">
                      <span className="preview-icon">🔍</span>
                      <span className="preview-path">{selectedFile.path}</span>
                    </div>
                    <button
                      className="close-preview"
                      onClick={() => setSelectedFile(null)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="preview-content">
                    <pre>
                      <code>{selectedFile.content}</code>
                    </pre>
                  </div>
                </div>
              </>
            )}

            {/* Download Section */}
            <div className="download-section">
              <input
                className="rename-input"
                type="text"
                value={zipName}
                onChange={(e) => setZipName(e.target.value)}
                placeholder="Enter ZIP file name..."
              />
              <button
                className="download-btn"
                onClick={handleDownload}
                disabled={loading || parsedFiles.length === 0}
              >
                {loading ? (
                  <>
                    <span className="spinner"></span>
                    Generating...
                  </>
                ) : (
                  <>💾 Download {zipName || "project"}.zip</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default App;
