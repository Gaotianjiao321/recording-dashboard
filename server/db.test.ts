import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from './db';

describe('database schema', () => {
  it('creates the MVP tables', () => {
    const db = new Database(':memory:');
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      'chunks',
      'parsed_results',
      'processing_jobs',
      'recordings',
      'tasks',
      'transcripts'
    ]);
  });
});

