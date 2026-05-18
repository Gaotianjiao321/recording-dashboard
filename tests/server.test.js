import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/server.js";

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://${address.address}:${address.port}` };
}

test("HTTP API processes a recording and exposes dashboard state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recording-dashboard-server-"));
  const app = await createApp({
    dbPath: join(dir, "server.sqlite"),
    services: {
      chunker: async () => ({
        durationSeconds: 20,
        chunks: [{ filePath: "api-chunk.mp3", position: 0, startSeconds: 0, endSeconds: 20 }]
      }),
      transcriber: async () => "TODO: call Alice. Decision: publish dashboard.",
      notifier: async () => {}
    }
  });
  const { server, baseUrl } = await listen(app);

  try {
    const processResponse = await fetch(`${baseUrl}/api/recordings/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "recordings/api.wav" })
    });
    assert.equal(processResponse.status, 201);
    const processResult = await processResponse.json();

    const dashboard = await (await fetch(`${baseUrl}/api/dashboard/today`)).json();
    assert.equal(dashboard.stats.recordings, 1);
    assert.equal(dashboard.tasks[0].status, "pending_confirm");

    const statusResponse = await fetch(`${baseUrl}/api/processing/${processResult.jobId}/status`);
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).status, "succeeded");

    const confirmResponse = await fetch(`${baseUrl}/api/tasks/${dashboard.tasks[0].id}/confirm`, {
      method: "POST"
    });
    assert.equal(confirmResponse.status, 200);
    assert.equal((await confirmResponse.json()).status, "confirmed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
