import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sqliteBusyTimeout = ".timeout 5000";

function defaultDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const home = process.env.HOME || "/tmp";
  return join(home, "Library/Application Support/com.recording-dashboard.app/data/recording-dashboard.sqlite");
}

export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export class Database {
  constructor(filePath = defaultDbPath()) {
    this.filePath = filePath;
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        duration_seconds REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'recording',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS processing_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recording_id) REFERENCES recordings(id)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        position INTEGER NOT NULL,
        start_seconds REAL NOT NULL,
        end_seconds REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recording_id) REFERENCES recordings(id)
      );
      CREATE TABLE IF NOT EXISTS transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        chunk_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recording_id) REFERENCES recordings(id),
        FOREIGN KEY(chunk_id) REFERENCES chunks(id)
      );
      CREATE TABLE IF NOT EXISTS parsed_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        summary TEXT NOT NULL,
        waiting_for_others TEXT NOT NULL DEFAULT '[]',
        decisions TEXT NOT NULL DEFAULT '[]',
        open_questions TEXT NOT NULL DEFAULT '[]',
        ideas TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recording_id) REFERENCES recordings(id)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        due_date TEXT,
        project TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recording_id) REFERENCES recordings(id)
      );
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(recording_id) REFERENCES recordings(id)
      );
    `);
    await this.ensureColumns("recordings", [
      { name: "source_type", definition: "TEXT NOT NULL DEFAULT 'recording'" }
    ]);
    await this.ensureColumns("tasks", [
      { name: "body", definition: "TEXT NOT NULL DEFAULT ''" },
      { name: "priority", definition: "TEXT NOT NULL DEFAULT 'medium'" },
      { name: "due_date", definition: "TEXT" },
      { name: "project", definition: "TEXT" }
    ]);
    await this.exec(`
      UPDATE recordings
      SET source_type = 'manual', status = 'manual'
      WHERE file_path = 'manual';

      INSERT OR IGNORE INTO projects (name)
      SELECT DISTINCT TRIM(project)
      FROM tasks
      WHERE project IS NOT NULL AND TRIM(project) != '';
    `);
  }

  async ensureColumns(table, columns) {
    const existing = new Set((await this.all(`PRAGMA table_info(${table})`)).map((column) => column.name));
    for (const column of columns) {
      if (!existing.has(column.name)) {
        await this.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`);
      }
    }
  }

  async exec(sql) {
    await execFileAsync("sqlite3", ["-cmd", sqliteBusyTimeout, this.filePath, sql], { maxBuffer: 1024 * 1024 * 8 });
  }

  async run(sql) {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-json", "-cmd", sqliteBusyTimeout, this.filePath, `${sql}; SELECT last_insert_rowid() AS id;`],
      { maxBuffer: 1024 * 1024 * 8 }
    );
    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    const row = rows.at(-1);
    return row?.id;
  }

  async all(sql) {
    const { stdout } = await execFileAsync("sqlite3", ["-json", "-cmd", sqliteBusyTimeout, this.filePath, sql], {
      maxBuffer: 1024 * 1024 * 8
    });
    return stdout.trim() ? JSON.parse(stdout) : [];
  }

  async get(sql) {
    const rows = await this.all(sql);
    return rows[0] ?? null;
  }
}
