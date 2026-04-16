/**
 * fsTools.js - Core File System Tools for Resume Assistant
 *
 * Provides readFile, listFiles, writeFile, and searchInFile
 * utilities designed to be called as LLM tools.
 */

import fs from "fs/promises";
import path from "path";
import { existsSync, statSync } from "fs";

// ── helpers ───────────────────────────────────────────────────────────────────

function fileMetadata(filePath) {
  const stat = statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return {
    name: path.basename(filePath),
    path: path.resolve(filePath),
    size_bytes: stat.size,
    modified: new Date(stat.mtimeMs).toISOString(),
    extension: ext,
  };
}

async function extractTextFromTxt(filePath) {
  return fs.readFile(filePath, "utf-8");
}

async function extractTextFromPdf(filePath) {
  try {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" || err.message.includes("Cannot find")) {
      throw new Error("pdf-parse is required to read PDF files. Run: npm install pdf-parse");
    }
    throw err;
  }
}

async function extractTextFromDocx(filePath) {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" || err.message.includes("Cannot find")) {
      throw new Error("mammoth is required to read DOCX files. Run: npm install mammoth");
    }
    throw err;
  }
}

// ── public tools ──────────────────────────────────────────────────────────────

/**
 * Read a resume file (PDF, TXT, or DOCX) and return its text content + metadata.
 * @param {string} filepath - Path to the file
 * @returns {object} { success, filepath, content, metadata, error }
 */
export async function readFile(filepath) {
  if (!existsSync(filepath)) {
    return { success: false, filepath, content: "", metadata: {}, error: `File not found: ${filepath}` };
  }

  const stat = statSync(filepath);
  if (!stat.isFile()) {
    return { success: false, filepath, content: "", metadata: {}, error: `Path is not a file: ${filepath}` };
  }

  const ext = path.extname(filepath).toLowerCase();

  try {
    let content;
    if (ext === ".txt") {
      content = await extractTextFromTxt(filepath);
    } else if (ext === ".pdf") {
      content = await extractTextFromPdf(filepath);
    } else if (ext === ".docx" || ext === ".doc") {
      content = await extractTextFromDocx(filepath);
    } else {
      return {
        success: false, filepath, content: "",
        metadata: fileMetadata(filepath),
        error: `Unsupported file type: ${ext}`,
      };
    }

    return {
      success: true,
      filepath: path.resolve(filepath),
      content,
      metadata: fileMetadata(filepath),
      error: null,
    };
  } catch (err) {
    return { success: false, filepath, content: "", metadata: {}, error: err.message };
  }
}

/**
 * List files in a directory, optionally filtered by extension.
 * @param {string} directory - Path to the directory
 * @param {string|null} extension - e.g. ".pdf", ".txt" (optional)
 * @returns {Array} Array of file metadata objects, or [{ error }] on failure
 */
export async function listFiles(directory, extension = null) {
  if (!existsSync(directory)) {
    return [{ error: `Directory not found: ${directory}` }];
  }

  const stat = statSync(directory);
  if (!stat.isDirectory()) {
    return [{ error: `Path is not a directory: ${directory}` }];
  }

  try {
    const entries = await fs.readdir(directory);
    const results = [];

    for (const name of entries.sort()) {
      const fullPath = path.join(directory, name);
      const fileStat = statSync(fullPath);
      if (!fileStat.isFile()) continue;

      const ext = path.extname(name).toLowerCase();
      if (extension && ext !== extension.toLowerCase()) continue;

      results.push({
        name,
        path: path.resolve(fullPath),
        size_bytes: fileStat.size,
        modified: new Date(fileStat.mtimeMs).toISOString(),
        extension: ext,
      });
    }

    return results;
  } catch (err) {
    return [{ error: err.message }];
  }
}

/**
 * Write text content to a file, creating parent directories as needed.
 * @param {string} filepath - Destination file path
 * @param {string} content - Text to write
 * @returns {object} { success, filepath, bytes_written, error }
 */
export async function writeFile(filepath, content) {
  try {
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filepath, content, "utf-8");
    const stat = statSync(filepath);
    return {
      success: true,
      filepath: path.resolve(filepath),
      bytes_written: stat.size,
      error: null,
    };
  } catch (err) {
    return { success: false, filepath, bytes_written: 0, error: err.message };
  }
}

/**
 * Search for a keyword inside a file (case-insensitive) with line context.
 * @param {string} filepath - Path to the file
 * @param {string} keyword - Keyword or phrase to search for
 * @returns {object} { success, filepath, keyword, match_count, matches, error }
 */
export async function searchInFile(filepath, keyword) {
  const readResult = await readFile(filepath);
  if (!readResult.success) {
    return { success: false, filepath, keyword, match_count: 0, matches: [], error: readResult.error };
  }

  const lines = readResult.content.split("\n");
  const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches = [];

  lines.forEach((line, i) => {
    if (pattern.test(line)) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 2);
      const context = lines.slice(start, end).join("\n");
      matches.push({ line_number: i + 1, line: line.trim(), context });
    }
    pattern.lastIndex = 0; // reset regex state
  });

  return {
    success: true,
    filepath,
    keyword,
    match_count: matches.length,
    matches,
    error: null,
  };
}

// ── tool schemas (Anthropic format) ──────────────────────────────────────────

export const TOOLS = [
  {
    name: "read_file",
    description:
      "Read a resume file (PDF, TXT, or DOCX) and return its full text content plus file metadata (size, modified date, extension).",
    input_schema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "Path to the file to read." },
      },
      required: ["filepath"],
    },
  },
  {
    name: "list_files",
    description:
      "List all files in a directory, optionally filtered by extension (e.g. '.pdf', '.txt'). Returns name, path, size, and modified date for each file.",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Path to the directory to scan." },
        extension: { type: "string", description: "Optional extension filter, e.g. '.txt'." },
      },
      required: ["directory"],
    },
  },
  {
    name: "write_file",
    description:
      "Write text content to a file. Creates parent directories if they do not exist. Returns success status and bytes written.",
    input_schema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "Destination file path." },
        content: { type: "string", description: "Text content to write." },
      },
      required: ["filepath", "content"],
    },
  },
  {
    name: "search_in_file",
    description:
      "Search for a keyword or phrase inside a file (case-insensitive). Returns each matching line with one line of surrounding context.",
    input_schema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "Path to the file to search." },
        keyword: { type: "string", description: "Keyword or phrase to search for." },
      },
      required: ["filepath", "keyword"],
    },
  },
];

// ── tool dispatcher ───────────────────────────────────────────────────────────

const TOOL_MAP = {
  read_file: ({ filepath }) => readFile(filepath),
  list_files: ({ directory, extension }) => listFiles(directory, extension),
  write_file: ({ filepath, content }) => writeFile(filepath, content),
  search_in_file: ({ filepath, keyword }) => searchInFile(filepath, keyword),
};

/**
 * Dispatch a tool call by name with the given input object.
 * @param {string} toolName
 * @param {object} toolInput
 * @returns {Promise<any>}
 */
export async function dispatchTool(toolName, toolInput) {
  const fn = TOOL_MAP[toolName];
  if (!fn) return { error: `Unknown tool: ${toolName}` };
  return fn(toolInput);
}
