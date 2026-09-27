import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { LibraryBackup } from '@libra/shared/library';
import { createApp } from '../../app.js';
import { openLibraryDatabase } from '../../db/database.js';
import { EntriesRepository } from './entries.repository.js';
import { createProviderRegistry } from '../../providers/catalog-provider.js';
import { createTmdbProvider } from '../../providers/tmdb.js';

const migrations = resolve('database/migrations');
const providers = createProviderRegistry([createTmdbProvider({})]);
let db: DatabaseSync; let repo: EntriesRepository; let api: ReturnType<typeof supertest>;
beforeEach(() => { db = openLibraryDatabase(':memory:', migrations); repo = new EntriesRepository(db); api = supertest(createApp(providers, undefined, repo)); });
afterEach(() => db.close());
const manual = (title = 'The Lantern Atlas') => ({ requestId: randomUUID(), mediaType: 'book' as const, title, originalTitle: '', description: 'An independent story', releaseDate: '2024', coverUrl: null, websiteUrl: null, status: 'completed' as const, details: { author: 'Mira Example', pages: 100 } });
function seed() {
  const tag = repo.createTag('Weekend').tag;
  const entry = repo.createManual({ ...manual(), tagIds: [tag.id, repo.tags()[0].id] }).entry;
  return { entry, tag };
}

describe('JSON library backups', () => {
  it('exports all active entries beyond one page with metadata and unused tags', async () => {
    const { entry, tag } = seed();
    for (let i = 0; i < 25; i++) repo.createManual(manual('Title ' + i));
    const removed = repo.createManual(manual('Removed')).entry; repo.remove(removed.id);
    const result = await api.get('/api/entries/backup').expect(200);
    expect(result.headers['content-disposition']).toContain('.json');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ format: 'libra-library', version: 1, exportedAt: expect.any(String) });
    expect(result.body.entries).toHaveLength(26);
    expect(result.body.entries.find((value: { id: string }) => value.id === entry.id)).toEqual(entry);
    expect(result.body.tags).toContainEqual(tag);
    expect(result.body.tags).toHaveLength(5);
  });

  it('round trips imported and manual entries into a fresh library with IDs, status, dates and tag relationships', async () => {
    seed();
    repo.save({ provider: 'tmdb', sourceId: '591', mediaType: 'movie', title: 'The Da Vinci Code', originalTitle: 'The Da Vinci Code', overview: 'A mystery.', releaseDate: '2006-05-17', posterUrl: null, rating: 6.7, voteCount: 20, externalUrl: 'https://www.themoviedb.org/movie/591' }, 'TMDB', 'in_progress');
    const backup = (await api.get('/api/entries/backup')).body as LibraryBackup;
    const otherDb = openLibraryDatabase(':memory:', migrations);
    try {
      const other = new EntriesRepository(otherDb); const target = supertest(createApp(providers, undefined, other));
      const preview = await target.post('/api/entries/backup/preview').send({ backup }).expect(200);
      expect(preview.body.summary).toMatchObject({ added: 2, updated: 0, kept: 0, tagsAdded: 1 });
      expect(other.index()).toHaveLength(0);
      const imported = await target.post('/api/entries/backup/import').send({ backup }).expect(200);
      expect(imported.body.summary).toEqual(preview.body.summary);
      expect(other.exportBackup().entries).toEqual(backup.entries);
      expect(other.exportBackup().tags).toEqual(backup.tags);
      expect((await target.post('/api/entries/backup/import').send({ backup }).expect(200)).body.summary).toMatchObject({ added: 0, kept: 2, tagsAdded: 0 });
      expect(other.index()).toHaveLength(2);
    } finally { otherDb.close(); }
  });

  it('keeps existing values by default, updates matching entries on request, and preserves unrelated entries', async () => {
    const { entry } = seed(); const backup = repo.exportBackup();
    repo.updateStatus(entry.id, 'dropped'); repo.setTags(entry.id, []);
    const unrelated = repo.createManual(manual('Unrelated')).entry;
    await api.post('/api/entries/backup/import').send({ backup }).expect(200);
    expect(repo.get(entry.id)).toMatchObject({ status: 'dropped', tags: [] });
    await api.post('/api/entries/backup/import').send({ backup, mode: 'update' }).expect(200);
    expect(repo.get(entry.id)).toEqual(entry);
    expect(repo.get(unrelated.id)).toEqual(unrelated);
    repo.remove(entry.id);
    const restored = await api.post('/api/entries/backup/import').send({ backup }).expect(200);
    expect(restored.body.summary.restored).toBe(1);
    expect(repo.get(entry.id)).toMatchObject({ id: entry.id, item: entry.item, status: entry.status, tags: entry.tags, addedAt: entry.addedAt });
  });

  it('reuses tag names and remaps colliding entry and tag IDs without corrupting either entry', async () => {
    const { entry, tag } = seed(); const backup = repo.exportBackup();
    backup.entries[0].item.sourceId = randomUUID(); backup.entries[0].item.title = 'Different title';
    const backupTag = backup.tags.find((value) => value.id === tag.id)!; backupTag.name = 'New tag with same ID';
    backup.entries[0].tags = [backupTag];
    await api.post('/api/entries/backup/import').send({ backup }).expect(200);
    expect(repo.get(entry.id)).toEqual(entry);
    const imported = repo.list({ query: 'Different title' }).entries[0];
    expect(imported.id).not.toBe(entry.id);
    expect(imported.tags[0]).toMatchObject({ name: 'New tag with same ID' });
    expect(imported.tags[0].id).not.toBe(tag.id);
    await api.post('/api/entries/backup/import').send({ backup }).expect(200);
    expect(repo.index()).toHaveLength(2);
  });

  it.each(['version', 'duplicate', 'unknown-tag', 'bad-url', 'invalid-detail'])('rejects %s without changing the library', async (kind) => {
    seed(); const before = repo.exportBackup(); const backup = structuredClone(before);
    if (kind === 'version') (backup as { version: number }).version = 2;
    if (kind === 'duplicate') backup.entries.push(backup.entries[0]);
    if (kind === 'unknown-tag') backup.entries[0].tags = [{ id: randomUUID(), name: 'Missing' }];
    if (kind === 'bad-url') backup.entries[0].item.posterUrl = 'javascript:alert(1)';
    if (kind === 'invalid-detail') backup.entries[0].details = { runtimeMinutes: 100 };
    for (const route of ['preview', 'import']) await api.post('/api/entries/backup/' + route).send({ backup }).expect(400);
    expect(repo.exportBackup().entries).toEqual(before.entries); expect(repo.tags()).toEqual(before.tags);
  });

  it('rolls back the entire import if a database write fails midway', async () => {
    const { entry } = seed(); const backup = repo.exportBackup(); repo.remove(entry.id);
    backup.tags.push({ id: randomUUID(), name: 'Not committed' });
    const beforeTags = repo.tags();
    db.exec("CREATE TRIGGER reject_restore BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    await api.post('/api/entries/backup/import').send({ backup, mode: 'update' }).expect(500);
    expect(repo.get(entry.id)).toBeNull(); expect(repo.tags()).toEqual(beforeTags);
  });

  it('supports backups above the normal entry body limit and protects cross-site writes', async () => {
    seed(); const backup = repo.exportBackup();
    for (let i = 0; i < 8; i++) backup.entries.push({ ...structuredClone(backup.entries[0]), id: randomUUID(), item: { ...backup.entries[0].item, sourceId: randomUUID(), overview: 'a'.repeat(50000) } });
    await api.post('/api/entries/backup/preview').send({ backup }).expect(200);
    await api.post('/api/entries/backup/import').set('Sec-Fetch-Site', 'cross-site').send({ backup: repo.exportBackup() }).expect(403);
    await api.post('/api/entries/backup/import').type('form').send({ backup: '{}' }).expect(415);
    await api.post('/api/entries/backup/import').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });

  it('saves tags atomically when creating an entry and retains the first tags on a retry', async () => {
    const tags = repo.tags(); const input = { ...manual(), tagIds: [tags[0].id, tags[1].id] };
    const result = await api.post('/api/entries/manual').send(input).expect(201);
    expect(result.body.entry.tags).toEqual(tags.slice(0, 2));
    await api.post('/api/entries/manual').send({ ...input, tagIds: [] }).expect(200);
    expect(repo.get(result.body.entry.id)?.tags).toEqual(tags.slice(0, 2));
    await api.post('/api/entries/manual').send({ ...manual(), tagIds: [randomUUID()] }).expect(400);
    expect(repo.index()).toHaveLength(1);
  });
});
