import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { postgresStore } from './store.js';
import { EntriesRepository } from '../modules/entries/entries.repository.js';
import type { LibraryBackup } from '@libra/shared/library';

const schema = readFileSync('database/postgres/001_library.sql', 'utf8');
const pg = new PGlite();
const store = postgresStore(work => pg.transaction(async tx => {
  await tx.exec('SET LOCAL search_path TO libra, public');
  return work(async (sql, values) => {
    const result = await tx.query<Record<string, unknown>>(sql, values);
    return { rows: result.rows, changes: result.affectedRows ?? 0 };
  });
}));
const repo = new EntriesRepository(store);
const manual = (title = 'A niche book') => ({ requestId: randomUUID(), mediaType: 'book' as const, title, originalTitle: '', description: 'A small press story', releaseDate: '2024', coverUrl: null, websiteUrl: null, status: 'planned' as const, details: { author: 'Mira Example', pages: 200 } });
beforeAll(async () => { await pg.exec(schema); }, 30_000);
beforeEach(async () => { await pg.exec('TRUNCATE libra.entries CASCADE;'); });
afterAll(async () => { await pg.close(); });

describe('PostgreSQL library integration', () => {
  it('runs the Supabase schema and preserves removed defaults when rerun', async () => {
    expect(await repo.tags()).toHaveLength(4);
    const { tag } = await repo.createTag('Test migration');
    await repo.deleteTag(tag.id);
    await pg.exec(schema);
    expect(await repo.tags()).toHaveLength(4);
  });
  it('persists entries, JSON details, case-sensitive API keys, statuses and many-to-many tags', async () => {
    const tags = await repo.tags();
    const { entry } = await repo.createManual({ ...manual(), tagIds: tags.slice(0, 2).map(t => t.id) });
    expect(await repo.get(entry.id)).toEqual(entry);
    expect(await repo.index()).toEqual([{ id: entry.id, provider: 'manual', sourceId: entry.item.sourceId, mediaType: 'book', status: 'planned', tagIds: expect.arrayContaining(tags.slice(0, 2).map(t => t.id)) }]);
    await repo.updateStatus(entry.id, 'completed');
    expect((await repo.get(entry.id))?.status).toBe('completed');
    await repo.setTags(entry.id, [tags[0].id]);
    expect((await repo.get(entry.id))?.tags).toEqual([tags[0]]);
    await repo.remove(entry.id); expect(await repo.get(entry.id)).toBeNull();
    expect((await repo.restore(entry.id))?.tags).toEqual([tags[0]]);
  });
  it('searches case-insensitive titles, details and literal wildcard characters with all selected tags', async () => {
    const { tag } = await repo.createTag('100%_club');
    const tags = await repo.tags();
    const { entry } = await repo.createManual({ ...manual("100% O'Brien_"), tagIds: [tag.id, tags[1].id] });
    for (const query of ['mIRA', '100%_', "o'BRIEN_", '%']) expect((await repo.list({ query })).entries[0]?.id).toBe(entry.id);
    expect((await repo.list({ query: '100X' })).totalResults).toBe(0);
    expect((await repo.list({ tagIds: [tag.id, tags[1].id], status: 'planned' })).totalResults).toBe(1);
    expect((await repo.list({ tagIds: [tag.id, randomUUID()] })).totalResults).toBe(0);
    await repo.deleteTag(tag.id);
  });
  it('paginates and sorts missing ratings last', async () => {
    for (let i = 0; i < 25; i++) await repo.createManual(manual('Book ' + i));
    await repo.save({ provider: 'tmdb', sourceId: '591', mediaType: 'movie', title: 'Rated movie', originalTitle: '', overview: '', releaseDate: null, posterUrl: null, rating: 7.1, voteCount: 5, externalUrl: 'https://www.themoviedb.org/movie/591' }, 'TMDB', 'completed');
    const list = await repo.list({ sort: 'rating_desc' });
    expect(list.entries).toHaveLength(24); expect(list.entries[0].item.title).toBe('Rated movie');
    expect((await repo.list({ page: 99 })).entries).toHaveLength(2);
    expect(list.summary).toEqual({ total: 26, byStatus: { planned: 25, completed: 1 } });
  });
  it('deduplicates concurrent saves and rolls back invalid atomic writes', async () => {
    const input = manual();
    const results = await Promise.all([repo.createManual(input), repo.createManual(input)]);
    expect(results.filter(r => r.created)).toHaveLength(1);
    await expect(repo.createManual({ ...manual(), tagIds: [randomUUID()] })).rejects.toThrow();
    expect((await repo.list({})).totalResults).toBe(1);
  });
  it('exports and imports complete snapshots with preview, update, keep and restore', async () => {
    const { entry } = await repo.createManual({ ...manual(), tagIds: [(await repo.tags())[0].id] });
    const backup = await repo.exportBackup();
    await repo.updateStatus(entry.id, 'dropped');
    expect((await repo.previewImport(backup, 'keep')).kept).toBe(1);
    await repo.importBackup(backup, 'keep'); expect((await repo.get(entry.id))?.status).toBe('dropped');
    await repo.importBackup(backup, 'update'); expect(await repo.get(entry.id)).toEqual(entry);
    await repo.remove(entry.id); expect((await repo.importBackup(backup, 'keep')).restored).toBe(1);
    await pg.exec('TRUNCATE libra.entries CASCADE');
    expect((await repo.importBackup(backup, 'keep')).added).toBe(1);
    expect((await repo.exportBackup()).entries).toEqual(backup.entries);
  });
  it('rolls back an entire import when a later database write fails', async () => {
    const backup = await repo.exportBackup();
    const entry = (await repo.createManual(manual())).entry;
    await pg.exec('TRUNCATE libra.entries CASCADE');
    const invalid = structuredClone(entry); invalid.id = randomUUID(); invalid.item.sourceId = randomUUID(); invalid.status = 'invalid' as never;
    const tag = { id: randomUUID(), name: 'Rollback tag' };
    const input: LibraryBackup = { ...backup, tags: [...backup.tags, tag], entries: [entry, invalid] };
    await expect(repo.importBackup(input, 'keep')).rejects.toThrow();
    expect(await repo.index()).toHaveLength(0);
    expect((await repo.tags()).find(t => t.id === tag.id)).toBeUndefined();
  });
});
