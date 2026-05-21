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

// Detect language hint for markdown code blocks
const detectLang = (content) => {
  const trimmed = content.trim();
  if (
    trimmed.includes("import React") ||
    trimmed.includes('from "react"') ||
    trimmed.includes("jsx")
  )
    return "jsx";
  if (trimmed.includes("<!DOCTYPE") || trimmed.includes("<html")) return "html";
  if (trimmed.includes("body {") || trimmed.includes("@media")) return "css";
  if (
    trimmed.startsWith("def ") ||
    trimmed.startsWith("import ") ||
    trimmed.startsWith("class ")
  )
    return "python";
  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch (e) {}
  }
  if (trimmed.startsWith("#!/bin/bash")) return "bash";
  if (
    trimmed.includes("const ") ||
    trimmed.includes("function ") ||
    trimmed.includes("=>")
  )
    return "javascript";
  return "";
};

// ---- Format converters ----
const filesToPythonDict = (files) => {
  let out = "files = {\n";
  files.forEach((f, i) => {
    const comma = i < files.length - 1 ? "," : "";
    if (!f.content.trim()) {
      out += `    "${f.path}": ""${comma}\n`;
    } else {
      out += `    "${f.path}": """${f.content}"""${comma}\n`;
    }
  });
  out += "}\n";
  return out;
};

const filesToMarkdown = (files) => {
  return files
    .map((f) => {
      const lang = detectLang(f.content);
      return `**${f.path}**\n\`\`\`${lang}\n${f.content}\n\`\`\``;
    })
    .join("\n\n");
};

const filesToDelimiter = (files) => {
  return files.map((f) => `==== ${f.path} ====\n${f.content}`).join("\n\n");
};

const OUTPUT_FORMATS = [
  { id: "python", label: "Python Dict" },
  { id: "markdown", label: "Markdown" },
  { id: "delimiter", label: "Delimiter" },
];

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

  const addFile = (path, content) => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;

    // Extract project name from path if it's the first part and not a standard folder
    const parts = trimmedPath.split("/");
    if (parts.length > 1) {
      const root = parts[0];
      const standardFolders = [
        "src",
        "public",
        "backend",
        "node_modules",
        "output",
        "uploads",
      ];
      if (!standardFolders.includes(root)) {
        if (!detectedProjectName) detectedProjectName = root;
        // If we found a project root, we strip it from the path for internal storage
        // so the tree starts from that root naturally
      }
    }

    const existing = files.find((f) => f.path === trimmedPath);
    if (existing) {
      existing.content += "\n\n" + content;
    } else {
      files.push({ path: trimmedPath, content });
    }
  };

  // 1. First, check for explicit file markers (highest priority)
  const commentFileRegex =
    /(?:\/\/|#)\s*file:\s*(.*?)\s*\n([\s\S]*?)(?=(?:\/\/|#)\s*file:\s*|$)/gi;
  let match;
  let hasMarkers = false;
  while ((match = commentFileRegex.exec(text)) !== null) {
    addFile(match[1], match[2].trim());
    hasMarkers = true;
  }

  // 2. If no markers, analyze sections word-by-word to categorize them
  if (!hasMarkers) {
    // Detect project name from package.json if present
    const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) detectedProjectName = nameMatch[1];

    const sections = text.split(
      /\n\s*(?=\/\/|#|\/\*|import|const|function|class|def|@|module\.exports|{)/,
    );

    sections.forEach((section) => {
      const trimmed = section.trim();
      if (!trimmed) return;

      // Smart routing based on content analysis
      if (
        trimmed.includes("express") ||
        trimmed.includes("multer") ||
        trimmed.includes("app.listen")
      ) {
        addFile("backend/server.js", trimmed);
      } else if (
        trimmed.includes("import React") ||
        trimmed.includes("export default")
      ) {
        addFile("src/App.js", trimmed);
      } else if (
        trimmed.includes("@tailwind") ||
        trimmed.includes("body {") ||
        /^\.[a-zA-Z]/.test(trimmed)
      ) {
        addFile("src/index.css", trimmed);
      } else if (trimmed.includes("tailwind.config")) {
        addFile("tailwind.config.js", trimmed);
      } else if (trimmed.includes('"dependencies":')) {
        if (trimmed.includes("express"))
          addFile("backend/package.json", trimmed);
        else addFile("package.json", trimmed);
      } else if (
        trimmed.startsWith("def ") ||
        trimmed.startsWith("class ") ||
        trimmed.includes("import ")
      ) {
        // If it looks like python but no clear path, default to main.py
        addFile("main.py", trimmed);
      }
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
    id: "auto",
    label: "🔄 Auto Format",
    desc: "Paste plain text → auto-converts to Python dict, Markdown, or delimiter format",
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
        style={{ paddingLeft: `${level * 16 + 12}px` }}
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
        style={{ paddingLeft: `${level * 16 + 12}px` }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="folder-icon">{isOpen ? "📂" : "📁"}</span>
        {node.name}
      </div>
      {isOpen &&
        Object.values(node.children)
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
  const [autoOutputFormat, setAutoOutputFormat] = useState("python");
  const [formattedOutput, setFormattedOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // Sync zipName in formatter mode only on initial switch or when input is cleared
  useEffect(() => {
    if (inputMode === "formatter" && !inputText.trim()) {
      setZipName("code-analyzer");
    }
  }, [inputMode, inputText]);

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

  // Auto format parser — detects files from plain text and formats them
  const parseTextAuto = useCallback((text) => {
    if (!text.trim()) return [];
    const files = [];
    const addFile = (path, content) => {
      const cleanPath = path.trim();
      if (!cleanPath) return;
      if (!files.find((f) => f.path === cleanPath)) {
        files.push({ path: cleanPath, content });
      }
    };

    // Try comment markers first: // file: path or # file: path
    const commentFileRegex =
      /(?:\/\/|#)\s*file:\s*(.*?)\s*\n([\s\S]*?)(?=(?:\/\/|#)\s*file:\s*|$)/gi;
    let match;
    while ((match = commentFileRegex.exec(text)) !== null) {
      addFile(match[1].trim(), match[2].trim());
    }
    if (files.length > 0) return files;

    // Try lines that look like file paths followed by code blocks
    // Pattern: a line that looks like a path (has extension), then code until next path-like line
    const lines = text.split("\n");
    let currentPath = null;
    let currentContent = [];

    const looksLikeFilePath = (line) => {
      const trimmed = line.trim();
      // Must contain a dot for extension, look like a relative path, no spaces (or few)
      return (
        /^[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+\s*:?\s*$/.test(trimmed) ||
        /^[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+$/.test(trimmed)
      );
    };

    for (const line of lines) {
      if (looksLikeFilePath(line)) {
        // Save previous file
        if (currentPath) {
          addFile(currentPath, currentContent.join("\n").trim());
        }
        currentPath = line.trim().replace(/:$/, "");
        currentContent = [];
      } else if (currentPath) {
        currentContent.push(line);
      }
    }
    // Save last file
    if (currentPath) {
      addFile(currentPath, currentContent.join("\n").trim());
    }

    // If nothing detected, treat the entire text as a single file
    if (files.length === 0 && text.trim()) {
      const ext = detectExtension(text);
      addFile(`code${ext}`, text.trim());
    }

    return files;
  }, []);

  // Auto-parse on text/mode change
  useEffect(() => {
    let files;
    if (inputMode === "smart") {
      files = parseTextSmart(inputText);
    } else if (inputMode === "raw") {
      files = parseTextRaw(inputText, rawFileName);
    } else if (inputMode === "formatter") {
      // Python Formatter Mode with Dynamic Structure
      const formatted = formatPythonCode(inputText);
      const { files: parsed, detectedProjectName } =
        parseProjectTemplate(formatted);

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
      files = parseTextAuto(inputText);
    }
    setParsedFiles(files);

    // Reset selected file if it's no longer in the list
    if (selectedFile && !files.find((f) => f.path === selectedFile.path)) {
      setSelectedFile(null);
    }

    // Generate formatted output for Auto mode
    if (inputMode === "auto" && files.length > 0) {
      let output = "";
      if (autoOutputFormat === "python") output = filesToPythonDict(files);
      else if (autoOutputFormat === "markdown") output = filesToMarkdown(files);
      else output = filesToDelimiter(files);
      setFormattedOutput(output);
    } else {
      setFormattedOutput("");
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
            : inputMode === "auto"
              ? 'Could not detect files. Try adding "// file: path" markers or "filename.ext" headers.'
              : "Enter some text to create a file.",
      });
    } else {
      setStatusMsg(null);
    }
  }, [
    inputText,
    inputMode,
    rawFileName,
    autoOutputFormat,
    parseTextSmart,
    parseTextRaw,
    parseTextAuto,
  ]);

  // Regenerate formatted output when format changes
  useEffect(() => {
    if (inputMode === "auto" && parsedFiles.length > 0) {
      let output = "";
      if (autoOutputFormat === "python")
        output = filesToPythonDict(parsedFiles);
      else if (autoOutputFormat === "markdown")
        output = filesToMarkdown(parsedFiles);
      else output = filesToDelimiter(parsedFiles);
      setFormattedOutput(output);
    }
  }, [autoOutputFormat, parsedFiles, inputMode]);

  // Recursive File Tree Structure
  const fileTree = useMemo(() => {
    const root = { name: zipName || "project", children: {}, isFolder: true };

    parsedFiles.forEach((file) => {
      const parts = file.path.split("/");
      let current = root;

      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          // It's a file
          current.children[part] = {
            name: part,
            path: file.path,
            isFolder: false,
            content: file.content,
          };
        } else {
          // It's a folder
          if (!current.children[part]) {
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
      const rootFolderName = zipName || "code-analyzer";
      const filesWithRoot = parsedFiles.map((f) => ({
        ...f,
        path: `${rootFolderName}/${f.path}`,
      }));

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

            {/* Auto mode: format selector */}
            {inputMode === "auto" && (
              <div className="format-selector">
                <span className="format-label">Output format:</span>
                {OUTPUT_FORMATS.map((fmt) => (
                  <button
                    key={fmt.id}
                    className={`format-btn ${autoOutputFormat === fmt.id ? "active" : ""}`}
                    onClick={() => setAutoOutputFormat(fmt.id)}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
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
                  : inputMode === "auto"
                    ? `Paste plain text here to auto-format...\n\nTip: Use "// file: path" markers or put filenames\non their own line:\n\nsrc/App.js\nimport React from 'react';\nconst App = () => <div>Hello</div>;\nexport default App;\n\nsrc/index.css\nbody { margin: 0; }\n\nThe output will be auto-converted to your\nchosen format (Python dict, Markdown, etc.)`
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

            {/* File Tree */}
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

            {/* File Preview Section */}
            {selectedFile && (
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
