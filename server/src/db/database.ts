import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openLibraryDatabase(filename: string, migrationDirectory: string): DatabaseSync {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
    // One transaction also makes concurrent startup migrations safe.
    db.exec('BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
    const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name));
    const files = readdirSync(migrationDirectory).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!files.length || [...applied].some((name) => !files.includes(String(name)))) throw new Error('Unrecognized database migration version');
    for (const name of files) {
      if (applied.has(name)) continue;
      db.exec(readFileSync(join(migrationDirectory, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}
