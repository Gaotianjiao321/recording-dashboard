import assert from "node:assert/strict";
import { test } from "node:test";
import { buildParserPrompt, parseTranscript, parseTranscriptWithHermes } from "../src/parser.js";

test("Hermes parser keeps the structured dashboard JSON contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.HERMES_API_URL;
  process.env.HERMES_API_URL = "https://hermes.test/v1/chat/completions";
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.messages[1].content.includes("my_todos"), true);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "完成项目同步",
                my_todos: ["补充 Secret Key"],
                waiting_for_others: ["等待验收"],
                decisions: ["改用 Hermes"],
                open_questions: ["Secret Key 在哪里"],
                ideas: ["增加本地通知"]
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const parsed = await parseTranscript("TODO: 补充 Secret Key. Decision: 改用 Hermes.");
    assert.deepEqual(parsed.my_todos, ["补充 Secret Key"]);
    assert.deepEqual(parsed.decisions, ["改用 Hermes"]);
    assert.deepEqual(parsed.open_questions, ["Secret Key 在哪里"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.HERMES_API_URL;
    else process.env.HERMES_API_URL = originalEndpoint;
  }
});

test("Hermes parser falls back to local parsing when no endpoint is configured", async () => {
  const originalEndpoint = process.env.HERMES_API_URL;
  delete process.env.HERMES_API_URL;
  try {
    const parsed = await parseTranscriptWithHermes("TODO: send notes. Decision: keep scope.");
    assert.deepEqual(parsed.my_todos, ["send notes"]);
    assert.deepEqual(parsed.decisions, ["keep scope"]);
  } finally {
    if (originalEndpoint !== undefined) process.env.HERMES_API_URL = originalEndpoint;
  }
});

test("parser prompt documents the exact output shape", () => {
  const prompt = buildParserPrompt("meeting transcript");
  assert.equal(prompt.includes('"summary"'), true);
  assert.equal(prompt.includes('"waiting_for_others"'), true);
  assert.equal(prompt.includes("Return only valid JSON"), true);
});
