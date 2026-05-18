import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "../src/db.js";
import { getTodayDashboard, processRecording, updateTaskStatus } from "../src/pipeline.js";

async function createTestDb() {
  const dir = await mkdtemp(join(tmpdir(), "recording-dashboard-"));
  const db = new Database(join(dir, "test.sqlite"));
  await db.init();
  return { db, dir };
}

function fakeChunker(chunks, durationSeconds = 60) {
  return async () => ({ durationSeconds, chunks });
}

test("processes recording through save, chunk, transcribe, parse, dashboard, and notification", async () => {
  const { db, dir } = await createTestDb();
  const recordingPath = join(dir, "meeting.wav");
  await writeFile(recordingPath, "fake audio");
  const notifications = [];

  const result = await processRecording(db, recordingPath, {
    chunker: fakeChunker([
      { filePath: "chunk-a.mp3", position: 0, startSeconds: 0, endSeconds: 30 },
      { filePath: "chunk-b.mp3", position: 1, startSeconds: 25, endSeconds: 60 }
    ]),
    transcriber: async (chunk) =>
      chunk.position === 0
        ? "Team sync. TODO: send plan. Decision: ship local MVP."
        : "Question: verify notification copy. Idea: add weekly trend.",
    notifier: async (notification) => {
      notifications.push(notification);
    }
  });

  assert.equal(result.parsed.my_todos[0].content, "send plan");

  const dashboard = await getTodayDashboard(db);
  assert.equal(dashboard.stats.recordings, 1);
  assert.equal(dashboard.stats.pendingTasks, 1);
  assert.equal(dashboard.latest.summary.includes("Team sync"), true);
  assert.deepEqual(dashboard.latest.decisions.map((item) => item.content), ["ship local MVP"]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].body.includes("send plan"), true);
});

test("supports short, long, and silent-like boundary recordings", async () => {
  const cases = [
    { name: "short", duration: 4, expectedPending: 1, chunks: [{ filePath: "short.mp3", position: 0, startSeconds: 0, endSeconds: 4 }] },
    {
      name: "long",
      duration: 1250,
      expectedPending: 1,
      chunks: [
        { filePath: "long-0.mp3", position: 0, startSeconds: 0, endSeconds: 600 },
        { filePath: "long-1.mp3", position: 1, startSeconds: 595, endSeconds: 1195 },
        { filePath: "long-2.mp3", position: 2, startSeconds: 1190, endSeconds: 1250 }
      ]
    },
    { name: "silent", duration: 30, expectedPending: 1, chunks: [{ filePath: "silent.mp3", position: 0, startSeconds: 0, endSeconds: 30 }] }
  ];

  for (const item of cases) {
    const { db } = await createTestDb();
    await processRecording(db, `${item.name}.wav`, {
      chunker: fakeChunker(item.chunks, item.duration),
      transcriber: async () => (item.name === "silent" ? "" : "TODO: boundary check"),
      notifier: async () => {}
    });

    const dashboard = await getTodayDashboard(db);
    assert.equal(dashboard.recordings[0].duration_seconds, item.duration);
    assert.equal(dashboard.stats.recordings, 1);
    assert.equal(dashboard.stats.pendingTasks, item.expectedPending);
  }
});

test("marks job failed when transcription fails", async () => {
  const { db } = await createTestDb();

  await assert.rejects(
    processRecording(db, "network.wav", {
      chunker: fakeChunker([{ filePath: "chunk.mp3", position: 0, startSeconds: 0, endSeconds: 20 }]),
      transcriber: async () => {
        throw new Error("network unavailable");
      },
      notifier: async () => {}
    }),
    /network unavailable/
  );

  const job = await db.get("SELECT status, error FROM processing_jobs LIMIT 1");
  const recording = await db.get("SELECT status FROM recordings LIMIT 1");
  assert.equal(job.status, "failed");
  assert.equal(job.error, "network unavailable");
  assert.equal(recording.status, "failed");
});

test("marks job failed when parser fails", async () => {
  const { db } = await createTestDb();

  await assert.rejects(
    processRecording(db, "parser.wav", {
      chunker: fakeChunker([{ filePath: "chunk.mp3", position: 0, startSeconds: 0, endSeconds: 20 }]),
      transcriber: async () => "TODO: parse this",
      parser: async () => {
        throw new Error("llm parse failed");
      },
      notifier: async () => {}
    }),
    /llm parse failed/
  );

  const job = await db.get("SELECT status, error FROM processing_jobs LIMIT 1");
  assert.equal(job.status, "failed");
  assert.equal(job.error, "llm parse failed");
});

test("task confirmation state machine supports confirmed and dismissed", async () => {
  const { db } = await createTestDb();
  await processRecording(db, "task.wav", {
    chunker: fakeChunker([{ filePath: "chunk.mp3", position: 0, startSeconds: 0, endSeconds: 10 }]),
    transcriber: async () => "TODO: confirm me",
    notifier: async () => {}
  });

  const task = await db.get("SELECT id FROM tasks LIMIT 1");
  assert.equal((await updateTaskStatus(db, task.id, "confirmed")).status, "confirmed");
  assert.equal((await updateTaskStatus(db, task.id, "dismissed")).status, "dismissed");
  await assert.rejects(updateTaskStatus(db, task.id, "pending_confirm"), /Unsupported task status/);
});
