function collectPrefixedLines(transcript, prefix) {
  return transcript
    .split(/\r?\n|[。.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((line) => line.slice(prefix.length).replace(/^[:：]\s*/, "").trim())
    .filter(Boolean);
}

export function parseTranscriptLocally(transcript) {
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

export function buildParserPrompt(transcript) {
  return `Extract a structured JSON object from this recording transcript.

Return only valid JSON with this exact shape:
{
  "summary": "short summary string",
  "my_todos": ["tasks for me"],
  "waiting_for_others": ["items waiting on other people"],
  "decisions": ["decisions made"],
  "open_questions": ["unresolved questions"],
  "ideas": ["ideas or opportunities"]
}

Rules:
- Keep every array present, even when empty.
- Use concise Chinese if the transcript is Chinese; otherwise keep the transcript language.
- Do not include markdown fences or commentary.

Transcript:
${transcript}`;
}

function optionalArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

function normalizeParsedResult(value, transcript) {
  const fallback = parseTranscriptLocally(transcript);
  return {
    summary: String(value?.summary || fallback.summary),
    my_todos: optionalArray(value?.my_todos ?? fallback.my_todos),
    waiting_for_others: optionalArray(value?.waiting_for_others),
    decisions: optionalArray(value?.decisions),
    open_questions: optionalArray(value?.open_questions),
    ideas: optionalArray(value?.ideas)
  };
}

function stripJsonFence(value) {
  return String(value)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractHermesContent(payload) {
  if (typeof payload === "string") return payload;
  if (payload?.summary || payload?.my_todos) return payload;

  const message = payload?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((item) => item?.text ?? item?.content ?? "")
      .join("")
      .trim();
  }

  return payload?.output_text ?? payload?.content ?? payload?.response ?? payload?.text ?? payload?.data;
}

export async function parseTranscriptWithHermes(transcript, options = {}) {
  const endpoint = options.endpoint ?? process.env.HERMES_API_URL;
  if (!endpoint) return parseTranscriptLocally(transcript);

  const prompt = buildParserPrompt(transcript);
  const body = {
    messages: [
      { role: "system", content: "You parse meeting transcripts into strict JSON for a local recording dashboard." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    response_format: { type: "json_object" }
  };
  const model = options.model ?? process.env.HERMES_MODEL;
  if (model) body.model = model;

  const headers = { "content-type": "application/json" };
  const apiKey = options.apiKey ?? process.env.HERMES_API_KEY;
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Hermes parser request failed: ${response.status} ${responseText}`);
  }

  const payload = responseText ? JSON.parse(responseText) : {};
  const content = extractHermesContent(payload);
  const parsed = typeof content === "string" ? JSON.parse(stripJsonFence(content)) : content;
  return normalizeParsedResult(parsed, transcript);
}

export async function parseTranscript(transcript) {
  return parseTranscriptWithHermes(transcript);
}
