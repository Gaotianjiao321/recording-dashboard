function collectPrefixedLines(transcript, prefix) {
  return transcript
    .split(/\r?\n|[。.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((line) => line.slice(prefix.length).replace(/^[:：]\s*/, "").trim())
    .filter(Boolean);
}

export function createParser(env = process.env, fetchImpl = fetch) {
  if (!env.ANTHROPIC_API_KEY) return parseTranscript;

  return async function parseWithClaude(transcript, context = {}) {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
        max_tokens: 2000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              `录音时间: ${context.recordedAt ?? "unknown"}`,
              `录音时长: ${context.durationSeconds ?? "unknown"} 秒`,
              "转写文本:",
              transcript
            ].join("\n")
          }
        ]
      }),
      signal: AbortSignal.timeout(Number(env.ANTHROPIC_TIMEOUT_MS ?? 60_000))
    });

    if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}: ${await response.text()}`);
    const json = await response.json();
    const text = json.content?.find((part) => part.type === "text")?.text;
    if (!text) throw new Error("Anthropic response did not contain text");
    return normalizeParsed(JSON.parse(extractJson(text)));
  };
}

export function parseTranscript(transcript) {
  const normalized = transcript.trim().replace(/\s+/g, " ");
  const todos = collectPrefixedLines(transcript, "TODO");
  const decisions = collectPrefixedLines(transcript, "Decision");
  const openQuestions = collectPrefixedLines(transcript, "Question");
  const ideas = collectPrefixedLines(transcript, "Idea");
  const waiting = collectPrefixedLines(transcript, "Waiting");

  return {
    summary: normalized.slice(0, 220) || "Recording processed with no transcript text.",
    my_todos: todos.length ? todos.map((content) => ({ content, priority: null, deadline: null })) : [{ content: "Review generated transcript", priority: null, deadline: null }],
    waiting_for_others: waiting.map((content) => ({ content, who: null, since: null })),
    decisions: decisions.map((content) => ({ content, context: null })),
    open_questions: openQuestions.map((content) => ({ content, context: null })),
    ideas: ideas.map((content) => ({ content, context: null }))
  };
}

export function normalizeParsed(parsed) {
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    my_todos: normalizeItems(parsed.my_todos),
    waiting_for_others: normalizeItems(parsed.waiting_for_others),
    decisions: normalizeItems(parsed.decisions),
    open_questions: normalizeItems(parsed.open_questions),
    ideas: normalizeItems(parsed.ideas)
  };
}

export function itemContent(item) {
  return typeof item === "string" ? item : item?.content;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") return { content: item };
      if (!item || typeof item !== "object" || typeof item.content !== "string") return null;
      return {
        content: item.content.trim(),
        deadline: stringOrNull(item.deadline),
        priority: ["high", "medium", "low"].includes(item.priority) ? item.priority : null,
        who: stringOrNull(item.who),
        since: stringOrNull(item.since),
        context: stringOrNull(item.context)
      };
    })
    .filter((item) => item?.content);
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("LLM output did not contain JSON");
  return text.slice(start, end + 1);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const systemPrompt = `你是一个工作录音分析助手。分析录音转写文本，提取结构化信息。

只输出 JSON，不要输出解释文字。JSON 结构必须为：
{
  "summary": "一句话总结录音内容",
  "my_todos": [
    {"content": "待办内容", "deadline": "YYYY-MM-DD 或 null", "priority": "high/medium/low"}
  ],
  "waiting_for_others": [
    {"content": "等待内容", "who": "等待谁", "since": "YYYY-MM-DD 或 null"}
  ],
  "decisions": [
    {"content": "决策内容", "context": "决策背景"}
  ],
  "open_questions": [
    {"content": "未解决问题", "context": "问题背景"}
  ],
  "ideas": [
    {"content": "想法", "context": "灵感来源"}
  ]
}

规则：
1. 只提取明确提到的内容，不要推测。
2. 任务必须有明确的行动动词。
3. 如果某个类别没有内容，返回空数组。
4. 保持原文措辞，不要改写。
5. 日期只能从录音上下文推断，无法确认时返回 null。`;
