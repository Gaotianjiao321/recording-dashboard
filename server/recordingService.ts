import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { AppDatabase } from './db';

export type ActiveRecording = {
  id: string;
  filePath: string;
  startedAt: string;
};

export type RecordingRow = {
  id: string;
  title: string | null;
  file_path: string;
  format: string;
  duration_ms: number | null;
  file_size_bytes: number | null;
  status: 'recording' | 'recorded' | 'failed';
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

type ActiveProcess = ActiveRecording & {
  process: ChildProcessWithoutNullStreams;
  startedMs: number;
};

const DEFAULT_RECORDINGS_DIR = 'recordings';

export class RecordingService {
  private active: ActiveProcess | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly recordingsDir = resolve(process.env.RECORDINGS_DIR ?? DEFAULT_RECORDINGS_DIR)
  ) {}

  getActive(): ActiveRecording | null {
    if (!this.active) {
      return null;
    }

    return {
      id: this.active.id,
      filePath: this.active.filePath,
      startedAt: this.active.startedAt
    };
  }

  listRecordings(limit = 20): RecordingRow[] {
    return this.db
      .prepare(
        `SELECT * FROM recordings
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(limit) as RecordingRow[];
  }

  start(): ActiveRecording {
    if (this.active) {
      throw new Error('A recording is already in progress.');
    }

    mkdirSync(this.recordingsDir, { recursive: true });

    const id = nanoid();
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const safeStamp = startedAt.replace(/[:.]/g, '-');
    const filePath = resolve(this.recordingsDir, `${safeStamp}-${id}.wav`);
    const now = startedAt;

    this.db
      .prepare(
        `INSERT INTO recordings (
          id, title, file_path, format, status, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'wav', 'recording', ?, ?, ?)`
      )
      .run(id, `Recording ${startedAt}`, filePath, startedAt, now, now);

    const child = spawn('ffmpeg', this.ffmpegArgs(filePath), {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.once('error', (error) => {
      this.failActive(id, error.message);
    });

    child.stderr.on('data', () => {
      // ffmpeg writes progress to stderr; keep the pipe drained.
    });

    this.active = {
      id,
      filePath,
      startedAt,
      startedMs,
      process: child
    };

    return this.getActive()!;
  }

  async stop(): Promise<RecordingRow> {
    if (!this.active) {
      throw new Error('No recording is in progress.');
    }

    const active = this.active;
    this.active = null;

    const exitPromise = new Promise<void>((resolveExit, rejectExit) => {
      active.process.once('close', (code) => {
        if (code === 0 || code === 255 || existsSync(active.filePath)) {
          resolveExit();
          return;
        }

        rejectExit(new Error(`ffmpeg exited with code ${code ?? 'unknown'}.`));
      });
      active.process.once('error', rejectExit);
    });

    active.process.stdin.write('q');
    active.process.stdin.end();

    await exitPromise;

    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - active.startedMs;
    const fileSizeBytes = existsSync(active.filePath) ? statSync(active.filePath).size : 0;
    const jobId = nanoid();

    this.db
      .transaction(() => {
        this.db
          .prepare(
            `UPDATE recordings
             SET status = 'recorded', ended_at = ?, duration_ms = ?, file_size_bytes = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(endedAt, durationMs, fileSizeBytes, endedAt, active.id);

        this.db
          .prepare(
            `INSERT INTO processing_jobs (
              id, recording_id, job_type, status, created_at, updated_at
            ) VALUES (?, ?, 'post_recording_pipeline', 'queued', ?, ?)`
          )
          .run(jobId, active.id, endedAt, endedAt);
      })();

    return this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(active.id) as RecordingRow;
  }

  private ffmpegArgs(filePath: string): string[] {
    const inputDevice = process.env.AUDIO_INPUT_DEVICE ?? ':0';

    if (process.platform === 'darwin') {
      return ['-y', '-f', 'avfoundation', '-i', inputDevice, '-ac', '1', '-ar', '16000', filePath];
    }

    return ['-y', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=16000', filePath];
  }

  private failActive(id: string, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE recordings
         SET status = 'failed', ended_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, id);

    if (this.active?.id === id) {
      this.active = null;
    }

    console.error(`Recording ${id} failed: ${errorMessage}`);
  }
}

