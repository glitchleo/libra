import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLibraryDatabase } from './database.js';
import { EntriesRepository } from '../modules/entries/entries.repository.js';

describe('comic media type SQLite migration', () => {
  it('upgrades an existing library while retaining entries, removed entries, manual details and tag relationships', async () => {
    const filename = join(tmpdir(), 'libra-comic-migration-' + randomUUID() + '.sqlite');
    let db = new DatabaseSync(filename);
    try {
      db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
      for (const name of ['001_library.sql', '002_manual_entries.sql', '003_library_tags.sql']) {
        db.exec(readFileSync(resolve('database/migrations', name), 'utf8'));
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, new Date().toISOString());
      }
      const repo = new EntriesRepository(db);
      const tags = await repo.tags();
      await repo.renameTag(tags[0].id, 'My favorites');
      const input = { requestId: randomUUID(), mediaType: 'book' as const, title: 'Existing book', originalTitle: '', description: '', releaseDate: '2024', coverUrl: null, websiteUrl: null, status: 'completed' as const, details: { author: 'A writer', pages: 144 }, tagIds: [tags[0].id, tags[1].id] };
      const active = (await repo.createManual(input)).entry;
      const removed = (await repo.createManual({ ...input, requestId: randomUUID(), title: 'Removed book' })).entry;
      await repo.remove(removed.id);
      const beforeRows = db.prepare('SELECT * FROM entries ORDER BY id').all();
      const beforeTags = await repo.tags();
      db.close();
      db = openLibraryDatabase(filename, resolve('database/migrations'));
      const upgraded = new EntriesRepository(db);
      expect(db.prepare('SELECT * FROM entries ORDER BY id').all()).toEqual(beforeRows);
      expect(await upgraded.get(active.id)).toEqual(active);
      expect(await upgraded.tags()).toEqual(beforeTags);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect((await upgraded.restore(removed.id))?.tags).toEqual(removed.tags);
      for (const mediaType of ['manhua', 'webtoon'] as const) {
        const saved = await upgraded.createManual({ ...input, requestId: randomUUID(), mediaType, title: mediaType, details: { chapters: 100 } });
        expect(saved.entry.item.mediaType).toBe(mediaType);
        expect((await upgraded.list({ mediaType })).totalResults).toBe(1);
      }
      // Cascade behavior still works after recreating the referencing table.
      await upgraded.deleteTag(tags[0].id);
      expect((await upgraded.get(active.id))?.tags.map(tag => tag.id)).toEqual([tags[1].id]);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      db.close();
      db = openLibraryDatabase(filename, resolve('database/migrations'));
      expect(db.prepare('SELECT count(*) AS count FROM schema_migrations').get()?.count).toBe(4);
    } finally {
      db.close();
      unlinkSync(filename);
    }
  });
});
