import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "../src/db.js";
import { parseTranscriptHeuristically } from "../src/parser.js";
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
    parser: parseTranscriptHeuristically,
    notifier: async (notification) => {
      notifications.push(notification);
    }
  });

  assert.equal(result.parsed.my_todos[0].title, "send plan");

  const dashboard = await getTodayDashboard(db);
  assert.equal(dashboard.stats.recordings, 1);
  assert.equal(dashboard.stats.pendingTasks, 1);
  assert.equal(dashboard.latest.summary.includes("Team sync"), true);
  assert.equal(dashboard.latest.summary.includes("TODO"), false);
  assert.deepEqual(dashboard.latest.decisions, ["ship local MVP"]);
  assert.equal(dashboard.tasks[0].title, "send plan");
  assert.equal(dashboard.tasks[0].body, "");
  assert.equal(dashboard.tasks[0].status, "pending_confirm");
  assert.equal(dashboard.projects[0].name, "录音解析");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].body.includes("send plan"), true);
});

test("supports short, long, and silent-like boundary recordings", async () => {
  const cases = [
    { name: "short", duration: 4, chunks: [{ filePath: "short.mp3", position: 0, startSeconds: 0, endSeconds: 4 }] },
    {
      name: "long",
      duration: 1250,
      chunks: [
        { filePath: "long-0.mp3", position: 0, startSeconds: 0, endSeconds: 600 },
        { filePath: "long-1.mp3", position: 1, startSeconds: 595, endSeconds: 1195 },
        { filePath: "long-2.mp3", position: 2, startSeconds: 1190, endSeconds: 1250 }
      ]
    },
    { name: "silent", duration: 30, chunks: [{ filePath: "silent.mp3", position: 0, startSeconds: 0, endSeconds: 30 }] }
  ];

  for (const item of cases) {
    const { db } = await createTestDb();
    await processRecording(db, `${item.name}.wav`, {
      chunker: fakeChunker(item.chunks, item.duration),
      transcriber: async () => (item.name === "silent" ? "" : "TODO: boundary check"),
      parser: parseTranscriptHeuristically,
      notifier: async () => {}
    });

    const dashboard = await getTodayDashboard(db);
    assert.equal(dashboard.recordings[0].duration_seconds, item.duration);
    assert.equal(dashboard.stats.recordings, 1);
    assert.equal(dashboard.stats.pendingTasks, item.chunks.length);
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

test("task status flow supports pending, in progress, waiting, done, archived, and dismissed", async () => {
  const { db } = await createTestDb();
  await processRecording(db, "task.wav", {
    chunker: fakeChunker([{ filePath: "chunk.mp3", position: 0, startSeconds: 0, endSeconds: 10 }]),
    transcriber: async () => "TODO: confirm me",
    parser: parseTranscriptHeuristically,
    notifier: async () => {}
  });

  const task = await db.get("SELECT id FROM tasks LIMIT 1");
  assert.equal((await updateTaskStatus(db, task.id, "in_progress")).status, "in_progress");
  assert.equal((await updateTaskStatus(db, task.id, "waiting")).status, "waiting");
  assert.equal((await updateTaskStatus(db, task.id, "done")).status, "done");
  assert.equal((await updateTaskStatus(db, task.id, "archived")).status, "archived");
  assert.equal((await updateTaskStatus(db, task.id, "pending_confirm")).status, "pending_confirm");
  assert.equal((await updateTaskStatus(db, task.id, "dismissed")).status, "dismissed");
  await assert.rejects(updateTaskStatus(db, task.id, "confirmed"), /Unsupported task status/);
});
