import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseTranscriptHeuristically } from "../src/parser.js";
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
    uploadDir: join(dir, "uploads"),
    services: {
      chunker: async () => ({
        durationSeconds: 20,
        chunks: [{ filePath: "api-chunk.mp3", position: 0, startSeconds: 0, endSeconds: 20 }]
      }),
      transcriber: async () => "TODO: call Alice. Decision: publish dashboard.",
      parser: parseTranscriptHeuristically,
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

    const dashboard = await (await fetch(`${baseUrl}/api/dashboard/today`)).json();
    assert.equal(dashboard.stats.recordings, 1);
    assert.equal(dashboard.tasks[0].status, "pending_confirm");

    const confirmResponse = await fetch(`${baseUrl}/api/tasks/${dashboard.tasks[0].id}/confirm`, {
      method: "POST"
    });
    assert.equal(confirmResponse.status, 200);
    assert.equal((await confirmResponse.json()).status, "in_progress");

    const doneResponse = await fetch(`${baseUrl}/api/tasks/${dashboard.tasks[0].id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" })
    });
    assert.equal(doneResponse.status, 200);
    assert.equal((await doneResponse.json()).status, "done");

    const upload = new FormData();
    upload.append("recording", new Blob(["fake wav bytes"], { type: "audio/wav" }), "meeting.wav");
    const uploadResponse = await fetch(`${baseUrl}/api/recordings/process`, {
      method: "POST",
      body: upload
    });
    assert.equal(uploadResponse.status, 201);

    const updatedDashboard = await (await fetch(`${baseUrl}/api/dashboard/today`)).json();
    assert.equal(updatedDashboard.stats.recordings, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("manual task creation via POST /api/tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recording-dashboard-manual-"));
  const app = await createApp({
    dbPath: join(dir, "manual.sqlite"),
    uploadDir: join(dir, "uploads"),
    services: {
      chunker: async () => ({ durationSeconds: 0, chunks: [] }),
      transcriber: async () => "",
      parser: parseTranscriptHeuristically,
      notifier: async () => {}
    }
  });
  const { server, baseUrl } = await listen(app);

  try {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "手动待办事项",
        priority: "high",
        due_date: "2026-05-20",
        project: "工作看板"
      })
    });
    assert.equal(res.status, 201);
    const task = await res.json();
    assert.equal(task.title, "手动待办事项");
    assert.equal(task.status, "pending_confirm");
    assert.equal(task.priority, "high");
    assert.equal(task.due_date, "2026-05-20");
    assert.equal(task.project, "工作看板");
    assert.ok(task.id > 0);

    const dashboard = await (await fetch(`${baseUrl}/api/dashboard/today`)).json();
    assert.equal(dashboard.stats.pendingTasks, 1);
    assert.equal(dashboard.stats.recordings, 0);
    assert.equal(dashboard.recordings.length, 0);
    assert.equal(dashboard.tasks[0].title, "手动待办事项");

    const badRes = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" })
    });
    assert.equal(badRes.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
