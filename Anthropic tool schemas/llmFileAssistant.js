/**
 * llmFileAssistant.js - LLM-powered Resume File Assistant
 *
 * Connects fsTools.js to Claude (Anthropic) using the tool-use API.
 * Supports an interactive REPL and single-query CLI mode.
 */

import Anthropic from "@anthropic-ai/sdk";
import readline from "readline";
import { TOOLS, dispatchTool } from "./fsTools.js";

// ── configuration ─────────────────────────────────────────────────────────────

const MODEL = "claude-opus-4-5";
const MAX_TOKENS = 4096;
const RESUMES_DIR = "resumes";

const SYSTEM_PROMPT = `You are a helpful Resume File Assistant.
You have access to four file-system tools:

• read_file       – read PDF / TXT / DOCX resume files
• list_files      – list files in a directory (optionally filter by extension)
• write_file      – write or create text files
• search_in_file  – search for keywords inside files

The default resume directory is "${RESUMES_DIR}/".

When the user asks you to do something, decide which tool(s) to call,
inspect the results, and then give a clear, concise answer.
If a task requires multiple steps (e.g. list files then read each one),
call tools one at a time and reason about each result before proceeding.`;

// ── agentic loop ──────────────────────────────────────────────────────────────

/**
 * Run the agent loop for a single user query.
 * Calls tools until Claude produces a final text response.
 *
 * @param {string} userQuery
 * @param {Anthropic} client
 * @param {boolean} verbose - print tool calls and intermediate output
 * @returns {Promise<string>} Claude's final answer
 */
export async function runAgent(userQuery, client, verbose = true) {
  const messages = [{ role: "user", content: userQuery }];

  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Collect any text parts
    const textParts = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text);

    if (verbose && textParts.length) {
      console.log("\n[Assistant]", textParts.join(" "));
    }

    // Done — return the final answer
    if (response.stop_reason === "end_turn") {
      return textParts.join(" ");
    }

    // Process tool_use blocks
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const { id, name, input } = block;

      if (verbose) {
        console.log(`\n[Tool call] ${name}(${JSON.stringify(input, null, 2)})`);
      }

      const result = await dispatchTool(name, input);

      const preview = JSON.stringify(result);
      if (verbose) {
        console.log(`[Tool result] ${preview.slice(0, 300)}${preview.length > 300 ? "…" : ""}`);
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: id,
        content: JSON.stringify(result),
      });
    }

    // Append assistant turn + results, then loop
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }
}

// ── interactive REPL ──────────────────────────────────────────────────────────

async function repl() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ERROR: ANTHROPIC_API_KEY environment variable not set.");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log("=".repeat(60));
  console.log("  Resume File Assistant  (type 'quit' to exit)");
  console.log("=".repeat(60));
  console.log(`  Resumes directory : ./${RESUMES_DIR}/`);
  console.log("  Example queries:");
  console.log('    "List all resumes in the resumes folder"');
  console.log('    "Find resumes mentioning Python experience"');
  console.log('    "Create a summary file for resume_john_doe.txt"');
  console.log("=".repeat(60));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("\nYou: ", async (input) => {
      const query = input.trim();
      if (!query) return ask();
      if (["quit", "exit", "q"].includes(query.toLowerCase())) {
        console.log("Goodbye!");
        rl.close();
        return;
      }
      try {
        await runAgent(query, client, true);
      } catch (err) {
        console.error("[Error]", err.message);
      }
      ask();
    });
  };

  ask();
}

// ── one-shot helper ───────────────────────────────────────────────────────────

/**
 * Convenience function: send a single query and return the answer.
 *
 * @param {string} query - Natural-language question/instruction
 * @param {object} options
 * @param {string} [options.apiKey] - Falls back to ANTHROPIC_API_KEY env var
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<string>}
 */
export async function ask(query, { apiKey, verbose = false } = {}) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key });
  return runAgent(query, client, verbose);
}

// ── entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length > 0) {
  // Non-interactive: treat CLI args as a single query
  const query = args.join(" ");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ERROR: ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });
  runAgent(query, client, true).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  repl();
}
