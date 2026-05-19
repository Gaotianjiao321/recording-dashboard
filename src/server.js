import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { Database, sqlValue } from "./db.js";
import {
  createProject,
  getProjectDashboard,
  getTodayDashboard,
  listProjects,
  processRecording,
  updateTask,
  updateTaskStatus
} from "./pipeline.js";

const allowedAudioExtensions = new Set([".wav", ".mp3", ".m4a", ".webm", ".ogg"]);
const allowedPriorities = new Set(["high", "medium", "low"]);
const allowedTaskStatuses = new Set(["pending_confirm", "in_progress", "done", "dismissed"]);

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg"
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const raw = (await readBody(request)).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function parseMultipartFile(body, contentType) {
  const boundary = contentType.match(/boundary=([^;]+)/)?.[1]?.replace(/^"|"$/g, "");
  if (!boundary) throw new Error("multipart boundary is required");

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    const partStart = cursor + boundaryBuffer.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;

    const headersStart = partStart + 2;
    const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), headersStart);
    if (headersEnd === -1) break;

    const headers = body.subarray(headersStart, headersEnd).toString("utf8");
    const fileName = headers.match(/filename="([^"]+)"/)?.[1];
    const name = headers.match(/name="([^"]+)"/)?.[1];
    const nextBoundary = body.indexOf(boundaryBuffer, headersEnd + 4);
    if (nextBoundary === -1) break;

    if (fileName && ["file", "recording"].includes(name)) {
      return {
        fileName,
        data: body.subarray(headersEnd + 4, Math.max(headersEnd + 4, nextBoundary - 2))
      };
    }

    cursor = nextBoundary;
  }

  throw new Error("recording file is required");
}

async function saveUploadedRecording(request, contentType, uploadDir) {
  const upload = parseMultipartFile(await readBody(request), contentType);
  const extension = extname(upload.fileName).toLowerCase();
  if (!allowedAudioExtensions.has(extension)) {
    throw new Error("only wav, mp3, m4a, webm, and ogg audio files are supported");
  }
  if (upload.data.length === 0) {
    throw new Error("uploaded recording is empty");
  }

  await mkdir(uploadDir, { recursive: true });
  const safeName = basename(upload.fileName, extension).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const filePath = join(uploadDir, `${Date.now()}-${randomUUID()}-${safeName || "recording"}${extension}`);
  await writeFile(filePath, upload.data);
  return filePath;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = join("public", relativePath);
  await stat(filePath);
  response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}

function normalizeTaskInput(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new Error("title is required");

  const taskBody = typeof body.body === "string" && body.body.trim() ? body.body.trim() : "";
  const priority = typeof body.priority === "string" && allowedPriorities.has(body.priority) ? body.priority : "medium";
  const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : null;
  const project = typeof body.project === "string" && body.project.trim() ? body.project.trim() : null;

  return { title, body: taskBody, priority, dueDate, project };
}

async function createManualTask(db, input) {
  const manualRecordingId = await db.run(`
    INSERT INTO recordings (file_path, status, source_type, duration_seconds)
    VALUES ('manual', 'manual', 'manual', 0)
  `);
  const taskId = await db.run(`
    INSERT INTO tasks (recording_id, title, body, status, priority, due_date, project)
    VALUES (
      ${sqlValue(manualRecordingId)},
      ${sqlValue(input.title)},
      ${sqlValue(input.body)},
      'pending_confirm',
      ${sqlValue(input.priority)},
      ${sqlValue(input.dueDate)},
      ${sqlValue(input.project)}
    )
  `);
  if (input.project) await createProject(db, input.project);
  return db.get(`
    SELECT id, recording_id, title, body, status, priority, due_date, project
    FROM tasks
    WHERE id = ${sqlValue(taskId)}
  `);
}

export async function createApp(options = {}) {
  const db = options.db ?? new Database(options.dbPath);
  const uploadDir = options.uploadDir ?? process.env.RECORDINGS_DIR ?? "recordings";
  await db.init();

  return async function app(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "POST" && url.pathname === "/api/tasks") {
        const body = await readJson(request);
        let input;
        try {
          input = normalizeTaskInput(body);
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
        const task = await createManualTask(db, input);
        return sendJson(response, 201, task);
      }

      if (request.method === "GET" && url.pathname === "/api/projects") {
        return sendJson(response, 200, await listProjects(db));
      }

      if (request.method === "POST" && url.pathname === "/api/projects") {
        try {
          return sendJson(response, 201, await createProject(db, (await readJson(request)).name));
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }

      if (request.method === "POST" && url.pathname === "/api/recordings/process") {
        const contentType = request.headers["content-type"] ?? "";
        const recordingPath = contentType.startsWith("multipart/form-data")
          ? await saveUploadedRecording(request, contentType, uploadDir)
          : (await readJson(request)).path;
        if (!recordingPath) return sendJson(response, 400, { error: "path is required" });
        const result = await processRecording(db, recordingPath, options.services);
        return sendJson(response, 201, result);
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard/today") {
        return sendJson(response, 200, await getTodayDashboard(db));
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard/projects") {
        return sendJson(response, 200, await getProjectDashboard(db));
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/(confirm|dismiss)$/);
      if (request.method === "POST" && taskMatch) {
        const status = taskMatch[2] === "confirm" ? "in_progress" : "dismissed";
        return sendJson(response, 200, await updateTaskStatus(db, Number(taskMatch[1]), status));
      }

      const taskStatusMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/status$/);
      if (request.method === "POST" && taskStatusMatch) {
        const { status } = await readJson(request);
        if (!allowedTaskStatuses.has(status)) {
          return sendJson(response, 400, { error: "unsupported task status" });
        }
        return sendJson(response, 200, await updateTaskStatus(db, Number(taskStatusMatch[1]), status));
      }

      const taskUpdateMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
      if ((request.method === "PATCH" || request.method === "PUT") && taskUpdateMatch) {
        try {
          return sendJson(response, 200, await updateTask(db, Number(taskUpdateMatch[1]), await readJson(request)));
        } catch (error) {
          return sendJson(response, error.message === "task not found" ? 404 : 400, { error: error.message });
        }
      }

      const recordingMatch = url.pathname.match(/^\/recordings\/([^/]+)$/);
      if (request.method === "GET" && recordingMatch && !recordingMatch[1].includes("..")) {
        const filePath = join(uploadDir, recordingMatch[1]);
        await stat(filePath);
        const ext = extname(filePath).toLowerCase();
        response.writeHead(200, { "content-type": contentTypes[ext] ?? "application/octet-stream" });
        createReadStream(filePath).pipe(response);
        return;
      }

      if (request.method === "GET") return serveStatic(request, response);

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      if (error.code === "ENOENT") return sendJson(response, 404, { error: "not found" });
      sendJson(response, 500, { error: error.message });
    }
  };
}
