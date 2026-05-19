import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const resultKeys = [
  "summary",
  "my_todos",
  "waiting_for_others",
  "decisions",
  "open_questions",
  "ideas"
];

function collectPrefixedLines(transcript, prefix) {
  return transcript
    .split(/\r?\n|[。.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((line) => line.slice(prefix.length).replace(/^[:：]\s*/, "").trim())
    .filter(Boolean);
}

function buildPrompt(transcript) {
  return `You are parsing a meeting transcript for a local recording dashboard.

Return only valid JSON. Do not wrap it in Markdown.

Required shape:
{
  "summary": "short plain-language summary",
  "my_todos": ["tasks owned by me"],
  "waiting_for_others": ["items blocked on other people"],
  "decisions": ["decisions made"],
  "open_questions": ["unresolved questions"],
  "ideas": ["ideas or follow-ups"]
}

Rules:
- Preserve the key names exactly.
- Use empty arrays when a category has no items.
- Do not invent people, dates, or tasks that are not supported by the transcript.
- Keep every array item concise and actionable.

Transcript:
${transcript}`;
}

function extractJson(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) {
    throw new Error("Hermes did not return JSON");
  }
  return JSON.parse(text.slice(first, last + 1));
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [String(value).trim()].filter(Boolean);
}

export function normalizeParsedResult(value) {
  const missing = resultKeys.filter((key) => !(key in value));
  if (missing.length) {
    throw new Error(`Hermes response missing keys: ${missing.join(", ")}`);
  }

  return {
    summary: String(value.summary ?? "").trim() || "Recording processed with no transcript text.",
    my_todos: normalizeArray(value.my_todos),
    waiting_for_others: normalizeArray(value.waiting_for_others),
    decisions: normalizeArray(value.decisions),
    open_questions: normalizeArray(value.open_questions),
    ideas: normalizeArray(value.ideas)
  };
}

export function parseTranscriptHeuristically(transcript) {
  const normalized = transcript.trim().replace(/\s+/g, " ");
  const todos = collectPrefixedLines(transcript, "TODO");
  const decisions = collectPrefixedLines(transcript, "Decision");
  const openQuestions = collectPrefixedLines(transcript, "Question");
  const ideas = collectPrefixedLines(transcript, "Idea");
  const waiting = collectPrefixedLines(transcript, "Waiting");

  return {
    summary: normalized.slice(0, 220) || "Recording processed with no transcript text.",
    my_todos: todos.length ? todos : ["Review generated transcript"],
    waiting_for_others: waiting,
    decisions,
    open_questions: openQuestions,
    ideas
  };
}

async function runHermes(prompt, options = {}) {
  const command = options.command ?? process.env.HERMES_COMMAND ?? "hermes";
  const timeoutMs = Number(options.timeoutMs ?? process.env.HERMES_TIMEOUT_MS ?? 120000);
  const { stdout } = await execFileAsync(command, ["-z", prompt, "--ignore-rules"], {
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 1024 * 1024 * 2,
    timeout: timeoutMs
  });
  return stdout;
}

export function createParser(options = {}) {
  return async function parseWithHermes(transcript) {
    const trimmed = transcript.trim();
    if (!trimmed) return parseTranscriptHeuristically(transcript);

    try {
      const output = await (options.runHermes ?? runHermes)(buildPrompt(trimmed), options);
      return normalizeParsedResult(extractJson(output));
    } catch (error) {
      if ((options.heuristicFallback ?? process.env.HERMES_HEURISTIC_FALLBACK !== "false") === false) {
        throw error;
      }
      return parseTranscriptHeuristically(transcript);
    }
  };
}

export const parseTranscript = createParser();
