import { chunkAudio } from "./audio.js";
import { sqlValue } from "./db.js";
import { notifyAndRecord } from "./notifications.js";
import { parseTranscript } from "./parser.js";
import { createTranscriber } from "./transcription.js";

function json(value) {
  return JSON.stringify(value ?? []);
}

function notificationBody(parsed) {
  const firstTodoTitle = todoTitle(parsed.my_todos?.[0]);
  const firstTodo = firstTodoTitle ? ` Todo: ${firstTodoTitle}` : "";
  return `${parsed.summary}${firstTodo}`.slice(0, 240);
}

const allowedTaskStatuses = new Set(["pending_confirm", "in_progress", "done", "dismissed"]);

function todoTitle(todo) {
  if (!todo) return "";
  if (typeof todo === "string") return todo;
  return String(todo.title ?? todo.body ?? "").trim();
}

function todoBody(todo) {
  if (!todo || typeof todo === "string") return "";
  return String(todo.body ?? "").trim();
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

    const todos = Array.isArray(parsed.my_todos) && parsed.my_todos.length > 0 
      ? parsed.my_todos 
      : [{ title: "录音解析纪要", body: parsed.summary }];

    await createProject(db, "录音解析");

    for (const todo of todos) {
      await db.run(`
        INSERT INTO tasks (recording_id, title, body, status, priority, project)
        VALUES (
          ${sqlValue(recordingId)},
          ${sqlValue(todoTitle(todo))},
          ${sqlValue(todoBody(todo))},
          'pending_confirm',
          'medium',
          '录音解析'
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
    SELECT id, file_path, duration_seconds, status, source_type, created_at
    FROM recordings
    WHERE source_type != 'manual'
    ORDER BY id DESC
  `);

  const latest = await db.get(`
    SELECT *
    FROM parsed_results
    ORDER BY id DESC
    LIMIT 1
  `);
  const tasks = await db.all(`
    SELECT id, recording_id, title, body, status, priority, due_date, project, created_at
    FROM tasks
    WHERE status != 'dismissed'
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
      pendingTasks: tasks.filter((task) => task.status === "pending_confirm").length,
      inProgressTasks: tasks.filter((task) => task.status === "in_progress").length,
      doneTasks: tasks.filter((task) => task.status === "done").length
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
    projects: groupTasksByProject(tasks),
    recordings,
    notifications
  };
}

export async function getProjectDashboard(db) {
  return { projects: groupTasksByProject(await db.all(`
    SELECT id, recording_id, title, body, status, priority, due_date, project, created_at
    FROM tasks
    WHERE status != 'dismissed'
    ORDER BY id DESC
  `)) };
}

export async function listProjects(db) {
  return db.all(`
    SELECT id, name, created_at
    FROM projects
    ORDER BY lower(name)
  `);
}

export async function createProject(db, name) {
  const normalizedName = String(name ?? "").trim();
  if (!normalizedName) throw new Error("project name is required");
  await db.exec(`INSERT OR IGNORE INTO projects (name) VALUES (${sqlValue(normalizedName)})`);
  return db.get(`SELECT id, name, created_at FROM projects WHERE name = ${sqlValue(normalizedName)}`);
}

export async function updateTaskStatus(db, taskId, status) {
  if (!allowedTaskStatuses.has(status)) {
    throw new Error(`Unsupported task status: ${status}`);
  }
  await db.exec(`
    UPDATE tasks
    SET status = ${sqlValue(status)}
    WHERE id = ${sqlValue(taskId)}
  `);
  return db.get(`
    SELECT id, recording_id, title, body, status, priority, due_date, project
    FROM tasks
    WHERE id = ${sqlValue(taskId)}
  `);
}

export async function updateTask(db, taskId, input) {
  const existing = await db.get(`
    SELECT id, title, body, status, priority, due_date, project
    FROM tasks
    WHERE id = ${sqlValue(taskId)}
  `);
  if (!existing) throw new Error("task not found");

  const title = String(input.title ?? existing.title).trim();
  if (!title) throw new Error("title is required");
  const body = String(input.body ?? existing.body ?? "").trim();
  const priority = input.priority ?? existing.priority;
  const status = input.status ?? existing.status;
  const dueDate = input.due_date === undefined ? existing.due_date : String(input.due_date || "").trim() || null;
  const project = input.project === undefined ? existing.project : String(input.project || "").trim() || null;

  if (!["high", "medium", "low"].includes(priority)) throw new Error("unsupported task priority");
  if (!allowedTaskStatuses.has(status)) throw new Error(`Unsupported task status: ${status}`);
  if (project) await createProject(db, project);

  await db.exec(`
    UPDATE tasks
    SET
      title = ${sqlValue(title)},
      body = ${sqlValue(body)},
      priority = ${sqlValue(priority)},
      due_date = ${sqlValue(dueDate)},
      project = ${sqlValue(project)},
      status = ${sqlValue(status)}
    WHERE id = ${sqlValue(taskId)}
  `);
  return db.get(`
    SELECT id, recording_id, title, body, status, priority, due_date, project
    FROM tasks
    WHERE id = ${sqlValue(taskId)}
  `);
}

function groupTasksByProject(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const name = task.project || "未归属";
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        total: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        doneTasks: 0,
        tasks: []
      });
    }
    const group = groups.get(name);
    group.total += 1;
    if (task.status === "pending_confirm") group.pendingTasks += 1;
    if (task.status === "in_progress") group.inProgressTasks += 1;
    if (task.status === "done") group.doneTasks += 1;
    group.tasks.push(task);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}
