# Resume File Assistant (Node.js)

An LLM-powered agent that reads, searches, and summarises resume files using
**Anthropic's Claude** tool-use API and four file-system tools — written entirely in Node.js.

---

## Project Structure

```
resume_assistant_js/
├── fsTools.js              # Part A – core file-system tools + Anthropic tool schemas
├── llmFileAssistant.js     # Part B – Claude agent with agentic tool-calling loop
├── package.json
├── README.md
└── resumes/                # Sample resume files (TXT / PDF / DOCX supported)
    ├── resume_john_doe.txt
    ├── resume_jane_smith.txt
    ├── resume_alice_chen.txt
    ├── resume_bob_martin.txt
    ├── resume_sara_jones.txt
    ├── resume_kevin_park.txt
    ├── resume_emily_brown.txt
    └── resume_raj_patel.txt
```

---

## Setup

### 1. Prerequisites

- Node.js 18 or later (ESM support required)
- An [Anthropic API key](https://console.anthropic.com/)

### 2. Install dependencies

```bash
npm install
```

### 3. Set your API key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Usage

### Interactive REPL

```bash
npm start
# or
node llmFileAssistant.js
```

Type any natural-language query:

```
You: List all resumes in the resumes folder
You: Find resumes mentioning Python experience
You: Create a summary file for resume_john_doe.txt
You: Which candidates know Kubernetes?
You: Read all resumes and give me a skills comparison
```

### Single query (CLI)

```bash
node llmFileAssistant.js "Find all resumes with machine learning experience"
```

### Programmatic use

```js
import { ask } from "./llmFileAssistant.js";

const answer = await ask("Which candidates know Docker?", { verbose: true });
console.log(answer);
```

---

## Tools Reference (Part A — `fsTools.js`)

| Tool | Signature | Description |
|------|-----------|-------------|
| `readFile` | `(filepath) → Promise<object>` | Reads PDF / TXT / DOCX; returns `content` + `metadata` |
| `listFiles` | `(directory, extension?) → Promise<array>` | Lists files; optional extension filter |
| `writeFile` | `(filepath, content) → Promise<object>` | Writes text file; creates dirs as needed |
| `searchInFile` | `(filepath, keyword) → Promise<object>` | Case-insensitive keyword search with line context |

### Return shapes

```js
// readFile
{ success: true, filepath: "...", content: "...", metadata: { name, size_bytes, modified, extension }, error: null }

// listFiles
[{ name: "resume_john_doe.txt", path: "...", size_bytes: 1234, modified: "2025-01-01T10:00:00.000Z", extension: ".txt" }]

// writeFile
{ success: true, filepath: "...", bytes_written: 512, error: null }

// searchInFile
{ success: true, filepath: "...", keyword: "Python", match_count: 3,
  matches: [{ line_number: 12, line: "...", context: "..." }], error: null }
```

---

## How It Works (Part B)

```
User query
   │
   ▼
Claude (claude-opus-4-5)  ←── TOOLS schema from fsTools.js
   │
   │  decides which tool(s) to call
   ▼
dispatchTool()  ──►  readFile / listFiles / writeFile / searchInFile
   │
   ▼  JSON result
Claude
   │  may call more tools, or produce final answer
   ▼
Final answer printed / returned
```

The agentic loop in `llmFileAssistant.js`:
1. Sends the user query + tool schemas to Claude.
2. For every `tool_use` block in the response, calls the matching function via `dispatchTool()`.
3. Feeds results back as `tool_result` messages.
4. Repeats until `stop_reason === "end_turn"`.

---

## Supported File Formats

| Format | Library |
|--------|---------|
| `.txt` | Node.js built-in `fs` |
| `.pdf` | `pdf-parse` |
| `.docx` | `mammoth` |

---

## Example Queries & Tools Called

| Query | Tools called |
|-------|-------------|
| "List all resumes" | `list_files` |
| "Find resumes mentioning Python" | `list_files` → `search_in_file` × N |
| "Read all resumes and summarise" | `list_files` → `read_file` × N |
| "Create a summary file for John Doe" | `read_file` → `write_file` |
| "Which candidates know Kubernetes?" | `list_files` → `search_in_file` × N |
