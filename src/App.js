import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
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

const detectExtension = (content) => {
  const trimmed = content.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html"))
    return ".html";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return ".json";
    } catch (e) {}
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

const parseProjectTemplate = (text) => {
  const files = [];
  let detectedProjectName = null;
  const lines = text.split("\n");

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

  const declarations = [];
  const stack = [];

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

    const otherRegexes = [
      /^\d+\.\s+([a-zA-Z0-9_./-]+\.[a-z0-9]+)/,
      /^(?:\/\/|#)\s*file:\s*([a-zA-Z0-9_./-]+\.[a-z0-9]+)/i,
      /^\*\*([a-zA-Z0-9_./-]+\.[a-z0-9]+)\*\*/,
      /"([a-zA-Z0-9_./-]+\.[a-z0-9]+)"\s*:/,
      /^([a-zA-Z0-9_./-]+\.[a-z0-9]+)$/i,
      /^([a-zA-Z0-9_./-]+\/)$/,
      /^[📁📄]\s*([a-zA-Z0-9_./-]+)/,
      /^path[:=]\s*([a-zA-Z0-9_./-]+)/i,
      /^([a-zA-Z0-9_./-]+\.[a-z0-9]+)\s*[:=]\s*$/i,
      /^#+\s+`?([a-zA-Z0-9_./-]+\.[a-z0-9]+)`?$/i,
      /^`([a-zA-Z0-9_./-]+\.[a-z0-9]+)`$/i,
    ];

    for (const reg of otherRegexes) {
      const m = trimmedLine.match(reg);
      if (m) {
        const p = normalizePath(m[1]);
        if (p) declarations.push({ path: p, isFolder: false, lineIndex: i });
        return;
      }
    }

    const treeMatch = line.match(/^([├──|└──|│\s]*)([a-zA-Z0-9_./-]+)/);
    const isTreeLine =
      treeMatch &&
      (trimmedLine.includes("├──") ||
        trimmedLine.includes("└──") ||
        trimmedLine.includes("│") ||
        trimmedLine.endsWith("/"));

    if (isTreeLine) {
      const markers = treeMatch[1];
      const name = treeMatch[2].trim();
      let level = 0;
      const markerChars = markers.split("");
      markerChars.forEach((c) => {
        if (c === "│") level += 1;
        else if (c === "├" || c === "└") level += 1;
        else if (c === "\t") level += 1;
      });
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
    }
  });

  const fileMap = new Map();

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
    let chunk = lines.slice(start, end).join("\n");
    chunk = chunk.replace(/^Copy\s*\n?/, "").replace(/\n?\s*Copy$/, "");
    const isTreeNoise =
      chunk.match(/^[├──|└──|│]/m) &&
      !chunk.includes("import ") &&
      !chunk.includes("const ") &&
      !chunk.includes("def ") &&
      !chunk.includes("function ") &&
      !chunk.includes("class ");

    if (isTreeNoise) chunk = "";

    const fenceMatch = chunk.match(/```[a-z]*\n([\s\S]*?)\n```/);
    if (fenceMatch) {
      chunk = fenceMatch[1];
    } else {
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
      const trimmedChunk = chunk.trim();
      if (!existing || trimmedChunk.length > 0) {
        const currentContent = existing ? existing.content : "";
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

  fileMap.forEach((val, path) => {
    if (!val.isFolder) {
      files.push({ path, content: val.content || "" });
    }
  });

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
    label: "🐍 Python Formatter ⭐",
    desc: "Most accurate! Analyses code word-by-word, organizes into clean project structure with fewer errors",
  },
];

const formatPythonCode = (text) => {
  if (!text) return "";
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

    if (atStartOfLine && keywordsDecreasingIndent.includes(trimmed)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    if (atStartOfLine) {
      result += "    ".repeat(indentLevel);
      atStartOfLine = false;
    } else {
      const lastChar = result.slice(-1);
      const isSymbol = /[:()[\]{},.+\-*\/=<>!&|^%]/.test(trimmed);
      const lastWasSymbol = /[:()[\]{},.+\-*\/=<>!&|^%]/.test(lastChar);
      if (lastChar && lastChar !== " " && lastChar !== "\n") {
        if (lastChar === ",") result += " ";
        else if (isSymbol || lastWasSymbol) {
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

    if (trimmed === ":") {
      let hasNewline = false;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j] === "\n") {
          hasNewline = true;
          break;
        }
        if (tokens[j].trim()) break;
      }
      if (hasNewline) indentLevel++;
    }
  }
  return result.trim();
};

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

const CodeToZipApp = () => {
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
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [manualOverrides, setManualOverrides] = useState({});
  const { user, logout } = useAuth();

  const generatePythonScript = useCallback((files, projectName) => {
    const filesDict = {};
    files.forEach((f) => {
      filesDict[f.path] = f.content;
    });
    const script = `import os
import zipfile
from pathlib import Path
desktop_path = Path.home() / "Desktop"
project_name = "${projectName || "project"}"
project_path = desktop_path / project_name
files = {
${Object.entries(filesDict)
  .map(
    ([path, content]) =>
      `    "${path}": """${content.replace(/"""/g, '\\"\\"\\""')}""",`,
  )
  .join("\n\n")}
}
print(f"Creating project: {project_name}...")
for file_path, content in files.items():
    full_path = project_path / file_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as file:
        file.write(content)
zip_path = desktop_path / f"{project_name}.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, filenames in os.walk(project_path):
        for filename in filenames:
            file_full_path = os.path.join(root, filename)
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

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      darkMode ? "dark" : "light",
    );
  }, [darkMode]);

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

  useEffect(() => {
    let files;
    if (inputMode === "smart") {
      files = parseTextSmart(inputText);
    } else if (inputMode === "raw") {
      files = parseTextRaw(inputText, rawFileName);
    } else if (inputMode === "formatter") {
      const { files: parsed, detectedProjectName } =
        parseProjectTemplate(inputText);
      files = parsed.map((f) => ({
        ...f,
        content: f.path.endsWith(".py")
          ? formatPythonCode(f.content)
          : f.content,
      }));
      if (detectedProjectName) setZipName(detectedProjectName);
    } else {
      files = [];
    }
    const finalFiles = files.map((f) => ({
      ...f,
      content:
        manualOverrides[f.path] !== undefined
          ? manualOverrides[f.path]
          : f.content,
    }));
    setParsedFiles(finalFiles);
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
  }, [
    inputText,
    inputMode,
    rawFileName,
    parseTextSmart,
    parseTextRaw,
    manualOverrides,
    selectedFile,
  ]);

  useEffect(() => {
    if (selectedFile) {
      setEditContent(selectedFile.content || "");
    } else {
      setIsEditing(false);
      setEditContent("");
    }
  }, [selectedFile]);

  const handleSaveEdit = () => {
    if (!selectedFile) return;
    setManualOverrides((prev) => ({
      ...prev,
      [selectedFile.path]: editContent,
    }));
    setSelectedFile((prev) => ({ ...prev, content: editContent }));
    setIsEditing(false);
    setStatusMsg({ type: "success", text: "File updated successfully!" });
  };

  const fileTree = useMemo(() => {
    const root = { name: zipName || "project", children: {}, isFolder: true };
    parsedFiles.forEach((file) => {
      if (!file.path) return;
      const parts = file.path.split("/").filter((p) => p.trim() !== "");
      let current = root;
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        if (isLast) {
          current.children[part] = {
            name: part,
            path: file.path,
            isFolder: false,
            content: file.content,
          };
        } else {
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pythonScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleDownload = async () => {
    if (parsedFiles.length === 0) return;
    setLoading(true);
    setStatusMsg({ type: "info", text: "Generating ZIP..." });
    try {
      const rootFolderName = (zipName || "code-analyzer").trim();
      const filesWithRoot = parsedFiles.map((f) => {
        const cleanPath = f.path
          .split("/")
          .filter((p) => p.trim() !== "")
          .join("/");
        return { ...f, path: `${rootFolderName}/${cleanPath}` };
      });
      const res = await axios.post(
        "/create-zip",
        { files: filesWithRoot },
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${zipName || "project"}.zip`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStatusMsg({
        type: "success",
        text: `Downloaded ${zipName || "project"}.zip!`,
      });
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

      <div className="app-container">
        <header className="app-header">
          <div className="app-title">
            <div className="logo-icon">⚡</div>
            <div>
              <h1>Code Analyzer - AI Powered</h1>
              <p className="app-subtitle">
                Paste code, preview structure, download as ZIP
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {user ? (
              <>
                <button
                  onClick={() => (window.location.href = "/dashboard")}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "8px",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Dashboard
                </button>
                <button onClick={logout} className="theme-toggle">
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => (window.location.href = "/login")}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  background: "#667eea",
                  color: "white",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Code Analyser
              </button>
            )}
            <button
              className="theme-toggle"
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
          </div>
        </header>

        <div className="main-layout">
          <div className="glass-panel editor-panel">
            {!user && (
              <div
                style={{
                  marginBottom: "20px",
                  padding: "15px",
                  background:
                    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  borderRadius: "10px",
                  color: "white",
                  textAlign: "center",
                }}
              >
                <p style={{ margin: "0 0 10px 0", fontSize: "16px" }}>
                  Want to analyse your code and generate quality reports?
                </p>
                <button
                  onClick={() => (window.location.href = "/login")}
                  style={{
                    padding: "10px 24px",
                    borderRadius: "8px",
                    border: "2px solid white",
                    background: "white",
                    color: "#667eea",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Use Code Analyser
                </button>
              </div>
            )}
            <div className="mode-tabs">
              {INPUT_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`mode-tab ${inputMode === mode.id ? "active" : ""}`}
                  style={
                    mode.id === "formatter"
                      ? {
                          background:
                            "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                          color: "white",
                          border: "none",
                          boxShadow: "0 4px 15px rgba(102, 126, 234, 0.3)",
                        }
                      : {}
                  }
                  onClick={() => setInputMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="panel-desc">
              {INPUT_MODES.find((m) => m.id === inputMode)?.desc}
            </p>
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
          </div>

          <div className="glass-panel sidebar-panel">
            <div className="sidebar-header">
              <h2>📁 File Structure</h2>
              <span className="file-count-badge">
                {parsedFiles.length} files
              </span>
            </div>

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
                      <button className="copy-btn" onClick={handleCopy}>
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
                    <div className="preview-actions">
                      {isEditing ? (
                        <button className="save-btn" onClick={handleSaveEdit}>
                          💾 Save
                        </button>
                      ) : (
                        <button
                          className="edit-btn"
                          onClick={() => setIsEditing(true)}
                        >
                          ✏️ Edit
                        </button>
                      )}
                      <button
                        className="close-preview"
                        onClick={() => setSelectedFile(null)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="preview-content">
                    {isEditing ? (
                      <textarea
                        className="edit-textarea"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <pre>
                        <code>{selectedFile.content}</code>
                      </pre>
                    )}
                  </div>
                </div>
              </>
            )}

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

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  return user ? children : <Navigate to="/login" />;
};

const App = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          fontSize: "24px",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={user ? <Navigate to="/dashboard" replace /> : <Signup />}
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<CodeToZipApp />} />
    </Routes>
  );
};

export default App;
