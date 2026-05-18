import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createParser,
  normalizeParsedResult,
  parseTranscriptHeuristically
} from "../src/parser.js";

test("Hermes parser preserves the required structured output", async () => {
  const parser = createParser({
    runHermes: async (prompt) => {
      assert.equal(prompt.includes("summary"), true);
      return JSON.stringify({
        summary: "Project sync covered launch readiness.",
        my_todos: ["Send the release plan"],
        waiting_for_others: ["Alice to confirm copy"],
        decisions: ["Ship the local MVP"],
        open_questions: ["Do we need a weekly trend?"],
        ideas: ["Add follow-up grouping"]
      });
    }
  });

  const parsed = await parser("TODO: Send the release plan. Decision: Ship the local MVP.");

  assert.deepEqual(parsed, {
    summary: "Project sync covered launch readiness.",
    my_todos: ["Send the release plan"],
    waiting_for_others: ["Alice to confirm copy"],
    decisions: ["Ship the local MVP"],
    open_questions: ["Do we need a weekly trend?"],
    ideas: ["Add follow-up grouping"]
  });
});

test("Hermes parser can extract JSON from fenced output", async () => {
  const parser = createParser({
    runHermes: async () => `\`\`\`json
{"summary":"Done","my_todos":[],"waiting_for_others":[],"decisions":[],"open_questions":[],"ideas":[]}
\`\`\``
  });

  assert.equal((await parser("Meeting transcript")).summary, "Done");
});

test("Hermes parser falls back to heuristic parsing when enabled", async () => {
  const parser = createParser({
    runHermes: async () => {
      throw new Error("Hermes unavailable");
    }
  });

  const parsed = await parser("TODO: Review notes. Decision: keep MVP local.");

  assert.equal(parsed.my_todos[0], "Review notes");
  assert.deepEqual(parsed.decisions, ["keep MVP local"]);
});

test("Hermes parser can fail hard when fallback is disabled", async () => {
  const parser = createParser({
    heuristicFallback: false,
    runHermes: async () => {
      throw new Error("Hermes unavailable");
    }
  });

  await assert.rejects(parser("TODO: Review notes"), /Hermes unavailable/);
});

test("parsed result normalization rejects missing keys", () => {
  assert.throws(
    () =>
      normalizeParsedResult({
        summary: "missing arrays"
      }),
    /missing keys/
  );
});

test("heuristic parser remains available for deterministic tests", () => {
  const parsed = parseTranscriptHeuristically("Waiting: Bob on approval. Idea: add tags.");
  assert.deepEqual(parsed.waiting_for_others, ["Bob on approval"]);
  assert.deepEqual(parsed.ideas, ["add tags"]);
});
