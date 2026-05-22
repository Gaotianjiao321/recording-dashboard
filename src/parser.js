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

function isCategorizedLine(line) {
  return ["TODO", "Decision", "Question", "Idea", "Waiting"].some((prefix) =>
    line.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

function summarizeTranscript(transcript, taskCount) {
  const summary = transcript
    .split(/\r?\n|[。.!?]/)
    .map((line) => line.trim())
    .filter((line) => line && !isCategorizedLine(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (summary) return summary.slice(0, 220);
  if (taskCount > 0) return `录音已解析，生成了 ${taskCount} 个待办。`;
  return "录音已处理，未提取到有效文本。";
}

function buildPrompt(transcript) {
  return `You are parsing a meeting transcript for a local recording dashboard.

Return only valid JSON. Do not wrap it in Markdown.

Required shape:
{
  "summary": "short plain-language summary",
  "my_todos": [
    { "title": "task title", "body": "task details, evidence, or context" }
  ],
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
- Put actionable tasks only in my_todos. Keep summary as a short overview, not a task list.
- Every item in my_todos must include title and body. Use an empty body only when the transcript has no extra context.

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

function normalizeTodoItem(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const title = String(value.title ?? value.name ?? "").trim();
    const body = String(value.body ?? value.description ?? value.details ?? "").trim();
    if (title) return { title, body };
    if (body) return { title: body.slice(0, 80), body };
    return null;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const [title, ...bodyParts] = text.split(/\s*[-:：]\s+/);
  const body = bodyParts.join(" - ").trim();
  return { title: title.trim() || text, body };
}

function normalizeTodos(value) {
  if (!Array.isArray(value)) {
    const item = normalizeTodoItem(value);
    return item ? [item] : [];
  }
  return value.map(normalizeTodoItem).filter(Boolean);
}

export function normalizeParsedResult(value) {
  const missing = resultKeys.filter((key) => !(key in value));
  if (missing.length) {
    throw new Error(`Hermes response missing keys: ${missing.join(", ")}`);
  }

  return {
    summary: String(value.summary ?? "").trim() || "录音已处理，未提取到有效文本。",
    my_todos: normalizeTodos(value.my_todos),
    waiting_for_others: normalizeArray(value.waiting_for_others),
    decisions: normalizeArray(value.decisions),
    open_questions: normalizeArray(value.open_questions),
    ideas: normalizeArray(value.ideas)
  };
}

export function parseTranscriptHeuristically(transcript) {
  const trimmed = (transcript ?? "").trim();
  if (!trimmed) {
    return {
      summary: "录音已保存，但转写服务未配置，无法自动解析内容。请配置腾讯云 ASR 或提供转写文本后重新解析。",
      my_todos: [{ title: "录音待解析", body: "转写服务未配置，录音内容无法自动提取。请配置 ASR 后重新处理。" }],
      waiting_for_others: [],
      decisions: [],
      open_questions: [],
      ideas: []
    };
  }

  const todos = collectPrefixedLines(transcript, "TODO");
  const decisions = collectPrefixedLines(transcript, "Decision");
  const openQuestions = collectPrefixedLines(transcript, "Question");
  const ideas = collectPrefixedLines(transcript, "Idea");
  const waiting = collectPrefixedLines(transcript, "Waiting");

  return {
    summary: summarizeTranscript(transcript, todos.length),
    my_todos: (todos.length ? todos : ["Review generated transcript"]).map((title) => ({ title, body: "" })),
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
