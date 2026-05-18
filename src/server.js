import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Database } from "./db.js";
import { getTodayDashboard, processRecording, updateTaskStatus } from "./pipeline.js";

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript"
};

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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

export async function createApp(options = {}) {
  const db = options.db ?? new Database(options.dbPath ?? process.env.DATABASE_PATH);
  await db.init();

  return async function app(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "POST" && url.pathname === "/api/recordings/process") {
        const body = await readJson(request);
        if (!body.path) return sendJson(response, 400, { error: "path is required" });
        const result = await processRecording(db, body.path, options.services);
        return sendJson(response, 201, result);
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard/today") {
        return sendJson(response, 200, await getTodayDashboard(db));
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/(confirm|dismiss)$/);
      if (request.method === "POST" && taskMatch) {
        const status = taskMatch[2] === "confirm" ? "confirmed" : "dismissed";
        return sendJson(response, 200, await updateTaskStatus(db, Number(taskMatch[1]), status));
      }

      if (request.method === "GET") return serveStatic(request, response);

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      if (error.code === "ENOENT") return sendJson(response, 404, { error: "not found" });
      sendJson(response, 500, { error: error.message });
    }
  };
}
