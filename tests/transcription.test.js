import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTencentAsrRequest, createTranscriber } from "../src/transcription.js";

test("Tencent ASR request uses Guangzhou endpoint and required action headers", () => {
  const request = buildTencentAsrRequest(
    { filePath: "chunk.mp3" },
    Buffer.from("audio"),
    {
      endpoint: "asr.ap-guangzhou.tencentcloudapi.com",
      region: "ap-guangzhou",
      secretId: "sid",
      secretKey: "skey",
      engine: "16k_zh"
    },
    new Date("2026-05-18T00:00:00Z")
  );

  assert.equal(request.url, "https://asr.ap-guangzhou.tencentcloudapi.com");
  assert.equal(request.headers["X-TC-Action"], "SentenceRecognition");
  assert.equal(request.headers["X-TC-Region"], "ap-guangzhou");
  assert.equal(JSON.parse(request.payload).EngSerViceType, "16k_zh");
});

test("Tencent ASR mode reports missing secret key clearly", async () => {
  const transcriber = createTranscriber({
    mode: "tencent",
    secretId: "sid",
    secretKey: "",
    endpoint: "asr.ap-guangzhou.tencentcloudapi.com"
  });

  await assert.rejects(
    transcriber({ filePath: "missing.mp3", position: 0 }),
    /TENCENT_SECRET_KEY/
  );
});

test("auto mode can use sidecar transcripts for local deterministic runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recording-dashboard-transcription-"));
  const filePath = join(dir, "chunk.mp3");
  await writeFile(`${filePath}.txt`, "Sidecar transcript");

  const transcriber = createTranscriber({ mode: "auto" });

  assert.equal(await transcriber({ filePath, position: 0 }), "Sidecar transcript");
});
