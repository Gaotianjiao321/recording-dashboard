import { chunkAudio } from "./audio.js";
import { sqlValue } from "./db.js";
import { notifyAndRecord } from "./notifications.js";
import { parseTranscript } from "./parser.js";
import { createTranscriber } from "./transcription.js";

function json(value) {
  return JSON.stringify(value ?? []);
}

function notificationBody(parsed) {
  const firstTodo = parsed.my_todos?.[0] ? ` Todo: ${parsed.my_todos[0]}` : "";
  return `${parsed.summary}${firstTodo}`.slice(0, 240);
}

export async function processRecording(db, recordingPath, services = {}) {
  const chunker = services.chunker ?? ((filePath) => chunkAudio(filePath));
  const transcriber = services.transcriber ?? createTranscriber();
  const parser = services.parser ?? parseTranscript;
  const notifier = services.notifier;

  const recordingId = await db.run(`
    INSERT INTO recordings (file_path, status)
    VALUES (${sqlValue(recordingPath)}, 'processing')
  `);
  const jobId = await db.run(`
    INSERT INTO processing_jobs (recording_id, status)
    VALUES (${sqlValue(recordingId)}, 'processing')
  `);

  try {
    const chunkResult = await chunker(recordingPath);
    await db.exec(`
      UPDATE recordings
      SET duration_seconds = ${sqlValue(chunkResult.durationSeconds)}
      WHERE id = ${sqlValue(recordingId)}
    `);

    const transcriptParts = [];
    for (const chunk of chunkResult.chunks) {
      const chunkId = await db.run(`
        INSERT INTO chunks (recording_id, file_path, position, start_seconds, end_seconds)
        VALUES (
          ${sqlValue(recordingId)},
          ${sqlValue(chunk.filePath)},
          ${sqlValue(chunk.position)},
          ${sqlValue(chunk.startSeconds)},
          ${sqlValue(chunk.endSeconds)}
        )
      `);
      const text = await transcriber(chunk);
      transcriptParts.push(text);
      await db.run(`
        INSERT INTO transcripts (recording_id, chunk_id, text)
        VALUES (${sqlValue(recordingId)}, ${sqlValue(chunkId)}, ${sqlValue(text)})
      `);
    }

    const transcript = transcriptParts.join("\n");
    const parsed = await parser(transcript);
    await db.run(`
      INSERT INTO parsed_results (
        recording_id,
        summary,
        waiting_for_others,
        decisions,
        open_questions,
        ideas
      )
      VALUES (
        ${sqlValue(recordingId)},
        ${sqlValue(parsed.summary)},
        ${sqlValue(json(parsed.waiting_for_others))},
        ${sqlValue(json(parsed.decisions))},
        ${sqlValue(json(parsed.open_questions))},
        ${sqlValue(json(parsed.ideas))}
      )
    `);

    for (const title of parsed.my_todos ?? []) {
      await db.run(`
        INSERT INTO tasks (recording_id, title, status)
        VALUES (${sqlValue(recordingId)}, ${sqlValue(title)}, 'pending_confirm')
      `);
    }

    await notifyAndRecord(
      db,
      recordingId,
      { title: "Recording parsed", body: notificationBody(parsed) },
      notifier
    );

    await db.exec(`
      UPDATE recordings SET status = 'processed' WHERE id = ${sqlValue(recordingId)};
      UPDATE processing_jobs
      SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)};
    `);

    return { recordingId, jobId, parsed };
  } catch (error) {
    await db.exec(`
      UPDATE recordings SET status = 'failed' WHERE id = ${sqlValue(recordingId)};
      UPDATE processing_jobs
      SET status = 'failed', error = ${sqlValue(error.message)}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)};
    `);
    throw error;
  }
}

export async function getTodayDashboard(db) {
  const recordings = await db.all(`
    SELECT id, file_path, duration_seconds, status, created_at
    FROM recordings
    ORDER BY id DESC
  `);
  const latest = await db.get(`
    SELECT *
    FROM parsed_results
    ORDER BY id DESC
    LIMIT 1
  `);
  const tasks = await db.all(`
    SELECT id, recording_id, title, status, created_at
    FROM tasks
    ORDER BY id DESC
  `);
  const notifications = await db.all(`
    SELECT id, recording_id, title, body, sent_at
    FROM notifications
    ORDER BY id DESC
  `);

  return {
    stats: {
      recordings: recordings.length,
      processing: recordings.filter((recording) => recording.status === "processing").length,
      pendingTasks: tasks.filter((task) => task.status === "pending_confirm").length
    },
    latest: latest
      ? {
          recordingId: latest.recording_id,
          summary: latest.summary,
          waiting_for_others: JSON.parse(latest.waiting_for_others),
          decisions: JSON.parse(latest.decisions),
          open_questions: JSON.parse(latest.open_questions),
          ideas: JSON.parse(latest.ideas)
        }
      : null,
    tasks,
    recordings,
    notifications
  };
}

export async function updateTaskStatus(db, taskId, status) {
  if (!["confirmed", "dismissed"].includes(status)) {
    throw new Error(`Unsupported task status: ${status}`);
  }
  await db.exec(`
    UPDATE tasks
    SET status = ${sqlValue(status)}
    WHERE id = ${sqlValue(taskId)}
  `);
  return db.get(`SELECT id, recording_id, title, status FROM tasks WHERE id = ${sqlValue(taskId)}`);
}
