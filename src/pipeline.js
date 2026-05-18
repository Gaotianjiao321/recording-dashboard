import { chunkAudio } from "./audio.js";
import { sqlValue } from "./db.js";
import { notifyAndRecord } from "./notifications.js";
import { createParser, itemContent } from "./parser.js";
import { createTranscriber, transcribeChunks } from "./transcription.js";

function json(value) {
  return JSON.stringify(value ?? []);
}

function notificationBody(parsed) {
  const firstTodo = parsed.my_todos?.[0] ? ` Todo: ${itemContent(parsed.my_todos[0])}` : "";
  return `${parsed.summary}${firstTodo}`.slice(0, 240);
}

export async function processRecording(db, recordingPath, services = {}) {
  return processRecordingInternal(db, recordingPath, services);
}

export async function retryProcessingJob(db, jobId, services = {}) {
  const job = await db.get(`
    SELECT processing_jobs.id, processing_jobs.recording_id, recordings.file_path
    FROM processing_jobs
    JOIN recordings ON recordings.id = processing_jobs.recording_id
    WHERE processing_jobs.id = ${sqlValue(jobId)}
  `);
  if (!job) throw new Error(`Processing job not found: ${jobId}`);

  await db.exec(`
    DELETE FROM chunks WHERE recording_id = ${sqlValue(job.recording_id)};
    DELETE FROM transcripts WHERE recording_id = ${sqlValue(job.recording_id)};
    DELETE FROM parsed_results WHERE recording_id = ${sqlValue(job.recording_id)};
    DELETE FROM tasks WHERE recording_id = ${sqlValue(job.recording_id)} AND status = 'pending_confirm';
  `);
  return processRecordingInternal(db, job.file_path, services, job.recording_id, job.id);
}

async function processRecordingInternal(db, recordingPath, services = {}, existingRecordingId = null, existingJobId = null) {
  const chunker = services.chunker ?? ((filePath) => chunkAudio(filePath));
  const transcriber = services.transcriber ?? createTranscriber();
  const parser = services.parser ?? createParser();
  const notifier = services.notifier;

  const recordingId =
    existingRecordingId ??
    (await db.run(`
      INSERT INTO recordings (file_path, status)
      VALUES (${sqlValue(recordingPath)}, 'processing')
    `));
  const jobId =
    existingJobId ??
    (await db.run(`
      INSERT INTO processing_jobs (recording_id, status, current_step, progress)
      VALUES (${sqlValue(recordingId)}, 'processing', 'chunking', 5)
    `));

  try {
    await db.exec(`
      UPDATE recordings SET status = 'processing' WHERE id = ${sqlValue(recordingId)};
      UPDATE processing_jobs
      SET status = 'processing', current_step = 'chunking', progress = 5, error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)};
    `);

    const chunkResult = await chunker(recordingPath);
    await db.exec(`
      UPDATE recordings
      SET duration_seconds = ${sqlValue(chunkResult.durationSeconds)}
      WHERE id = ${sqlValue(recordingId)}
    `);

    const chunkRows = [];
    for (const chunk of chunkResult.chunks) {
      const chunkId = await db.run(`
        INSERT INTO chunks (
          recording_id,
          file_path,
          position,
          start_seconds,
          end_seconds,
          file_size_bytes,
          transcription_status
        )
        VALUES (
          ${sqlValue(recordingId)},
          ${sqlValue(chunk.filePath)},
          ${sqlValue(chunk.position)},
          ${sqlValue(chunk.startSeconds)},
          ${sqlValue(chunk.endSeconds)},
          ${sqlValue(chunk.fileSizeBytes ?? 0)},
          'pending'
        )
      `);
      chunkRows.push({ ...chunk, id: chunkId });
    }

    await db.exec(`
      UPDATE processing_jobs
      SET current_step = 'transcribing', progress = 35, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)}
    `);

    await db.exec(`
      UPDATE chunks
      SET transcription_status = 'processing'
      WHERE recording_id = ${sqlValue(recordingId)}
    `);

    let transcriptParts;
    try {
      transcriptParts = await transcribeChunks(chunkRows, transcriber);
    } catch (error) {
      await db.exec(`
        UPDATE chunks
        SET transcription_status = 'failed'
        WHERE recording_id = ${sqlValue(recordingId)}
          AND transcription_status = 'processing'
      `);
      throw error;
    }

    for (const [index, text] of transcriptParts.entries()) {
      const chunk = chunkRows[index];
      await db.exec(`
        UPDATE chunks
        SET transcription_status = 'completed'
        WHERE id = ${sqlValue(chunk.id)}
      `);
      await db.run(`
        INSERT INTO transcripts (recording_id, chunk_id, text)
        VALUES (${sqlValue(recordingId)}, ${sqlValue(chunk.id)}, ${sqlValue(text)})
      `);
    }

    const transcript = mergeTranscriptParts(chunkRows, transcriptParts);
    await db.exec(`
      UPDATE processing_jobs
      SET current_step = 'parsing', progress = 78, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)}
    `);
    const parsed = await parser(transcript, {
      recordingId,
      recordedAt: new Date().toISOString(),
      durationSeconds: chunkResult.durationSeconds
    });

    await db.exec(`
      UPDATE processing_jobs
      SET current_step = 'saving', progress = 92, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)}
    `);
    await db.run(`
      INSERT INTO parsed_results (
        recording_id,
        summary,
        raw_json,
        waiting_for_others,
        decisions,
        open_questions,
        ideas
      )
      VALUES (
        ${sqlValue(recordingId)},
        ${sqlValue(parsed.summary)},
        ${sqlValue(JSON.stringify(parsed))},
        ${sqlValue(json(parsed.waiting_for_others))},
        ${sqlValue(json(parsed.decisions))},
        ${sqlValue(json(parsed.open_questions))},
        ${sqlValue(json(parsed.ideas))}
      )
    `);

    for (const todo of parsed.my_todos ?? []) {
      const title = itemContent(todo);
      if (!title) continue;
      await db.run(`
        INSERT INTO tasks (recording_id, title, category, status, deadline, priority, context)
        VALUES (
          ${sqlValue(recordingId)},
          ${sqlValue(title)},
          'my_todo',
          'pending_confirm',
          ${sqlValue(todo.deadline)},
          ${sqlValue(todo.priority)},
          ${sqlValue(todo.context)}
        )
      `);
    }

    for (const waiting of parsed.waiting_for_others ?? []) {
      const title = itemContent(waiting);
      if (!title) continue;
      await db.run(`
        INSERT INTO tasks (recording_id, title, category, status, deadline, who, context)
        VALUES (
          ${sqlValue(recordingId)},
          ${sqlValue(title)},
          'waiting_for',
          'pending_confirm',
          ${sqlValue(waiting.since)},
          ${sqlValue(waiting.who)},
          ${sqlValue(waiting.context)}
        )
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
      SET status = 'succeeded', current_step = 'saving', progress = 100, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlValue(jobId)};
    `);

    return { recordingId, jobId, transcript, parsed };
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
    SELECT id, recording_id, title, category, status, deadline, priority, who, context, created_at
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

export function mergeTranscriptParts(chunks, transcriptParts) {
  return chunks
    .map((chunk, index) => ({ chunk, text: transcriptParts[index]?.trim() ?? "" }))
    .sort((a, b) => a.chunk.position - b.chunk.position)
    .filter((part) => part.text)
    .reduce((merged, part) => {
      if (!merged) return part.text;
      const next = trimOverlap(merged, part.text);
      return next ? `${merged}\n${next}` : merged;
    }, "");
}

function trimOverlap(previous, current) {
  const max = Math.min(previous.length, current.length, 120);
  for (let size = max; size >= 8; size -= 1) {
    if (previous.endsWith(current.slice(0, size))) return current.slice(size).trimStart();
  }
  return current;
}
