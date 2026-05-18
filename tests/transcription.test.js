import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TencentAsrClient, transcribeChunks, withRetry } from "../src/transcription.js";

test("transcribeChunks preserves chunk order under concurrency", async () => {
  const result = await transcribeChunks(
    [
      { position: 0, filePath: "a.mp3" },
      { position: 1, filePath: "b.mp3" },
      { position: 2, filePath: "c.mp3" }
    ],
    async (chunk) => `chunk-${chunk.position}`,
    { concurrency: 2, attempts: 1 }
  );

  assert.deepEqual(result, ["chunk-0", "chunk-1", "chunk-2"]);
});

test("withRetry retries transient transcription failures", async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary network error");
      return "ok";
    },
    { attempts: 2, timeoutMs: 1000, baseDelayMs: 0 }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("TencentAsrClient creates and polls a recognition task", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recording-dashboard-asr-"));
  const audioPath = join(dir, "chunk.mp3");
  await writeFile(audioPath, "audio-bytes");

  const actions = [];
  const client = new TencentAsrClient(
    {
      secretId: "secret-id",
      secretKey: "secret-key",
      region: "ap-guangzhou",
      engineModelType: "16k_zh",
      pollIntervalMs: 0,
      timeoutMs: 1000
    },
    async (_url, init) => {
      actions.push(init.headers["X-TC-Action"]);
      if (init.headers["X-TC-Action"] === "CreateRecTask") {
        return jsonResponse({ Response: { Data: { TaskId: 42 }, RequestId: "create" } });
      }
      return jsonResponse({
        Response: {
          Data: { Status: 2, StatusStr: "success", Result: "转写结果" },
          RequestId: "describe"
        }
      });
    }
  );

  const text = await client.transcribeChunk({ filePath: audioPath });
  assert.equal(text, "转写结果");
  assert.deepEqual(actions, ["CreateRecTask", "DescribeTaskStatus"]);
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}
