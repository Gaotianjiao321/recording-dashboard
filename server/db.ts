import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type AppDatabase = Database.Database;

export function resolveDatabasePath(path = process.env.DATABASE_PATH): string {
  return resolve(path ?? 'data/app.sqlite');
}

export function openDatabase(path = resolveDatabasePath()): AppDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      title TEXT,
      file_path TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'wav',
      duration_ms INTEGER,
      file_size_bytes INTEGER,
      status TEXT NOT NULL CHECK (status IN ('recording', 'recorded', 'failed')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (recording_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
      provider TEXT,
      text TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parsed_results (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      summary TEXT,
      my_todos_json TEXT NOT NULL DEFAULT '[]',
      waiting_for_others_json TEXT NOT NULL DEFAULT '[]',
      decisions_json TEXT NOT NULL DEFAULT '[]',
      open_questions_json TEXT NOT NULL DEFAULT '[]',
      ideas_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      recording_id TEXT REFERENCES recordings(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'llm',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending_confirm' CHECK (status IN ('pending_confirm', 'confirmed', 'dismissed')),
      due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recordings_started_at ON recordings(started_at);
    CREATE INDEX IF NOT EXISTS idx_chunks_recording_sequence ON chunks(recording_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
}

