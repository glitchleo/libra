import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openLibraryDatabase } from '../../db/database.js';
import { createApp } from '../../app.js';
import { createProviderRegistry } from '../../providers/catalog-provider.js';
import { EntriesRepository } from './entries.repository.js';
import type { LibraryTag } from '@libra/shared/library';

const migrations = resolve('database/migrations');
let db: DatabaseSync;
let repo: EntriesRepository;
let api: ReturnType<typeof supertest>;
beforeEach(() => {
  db = openLibraryDatabase(':memory:', migrations);
  repo = new EntriesRepository(db);
  api = supertest(createApp(createProviderRegistry([]), undefined, repo));
});
afterEach(() => db.close());
const addEntry = async (title: string, mediaType = 'book', status = 'planned') =>
  (await api.post('/api/entries/manual').send({ title, mediaType, status, requestId: randomUUID() }).expect(201)).body.entry;

describe('library tags', () => {
  it('provides editable defaults and deduplicates normalized names, including concurrent creates', async () => {
    const defaults = await api.get('/api/entries/tags').expect(200);
    expect(defaults.body.tags.map((tag: LibraryTag) => tag.name)).toEqual(['Favorites', 'Hidden gems', 'Recommended', 'Revisit']);
    const results = await Promise.all(['  Cozy   evenings ', 'cozy evenings', 'COZY EVENINGS'].map((name) => api.post('/api/entries/tags').send({ name })));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(new Set(results.map((result) => result.body.tag.id)).size).toBe(1);
    expect(results[0].body.tag.name).toBe('Cozy evenings');
    const duplicate = await api.post('/api/entries/tags').send({ name: 'ＦＡＶＯＲＩＴＥＳ' }).expect(200);
    expect(duplicate.body.tag.id).toBe(defaults.body.tags[0].id);
  });

  it('supports many tags on an entry and shares a tag across different media', async () => {
    const book = await addEntry('A book');
    const game = await addEntry('A game', 'game');
    const [first, second] = repo.tags();
    await api.patch(`/api/entries/${book.id}/tags`).send({ tagIds: [first.id, second.id, first.id] }).expect(200);
    await api.patch(`/api/entries/${game.id}/tags`).send({ tagIds: [first.id] }).expect(200);
    expect(repo.get(book.id)?.tags).toEqual([first, second]);
    expect(repo.get(game.id)?.tags).toEqual([first]);
    expect(repo.index().find((entry) => entry.id === book.id)?.tagIds.sort()).toEqual([first.id, second.id].sort());
    const index = await api.get('/api/entries/index').expect(200);
    expect(index.body.tags).toEqual(repo.tags());
    await api.patch(`/api/entries/${book.id}/tags`).send({ tagIds: [] }).expect(200);
    expect(repo.get(book.id)?.tags).toEqual([]);
    expect(repo.get(game.id)?.tags).toEqual([first]);
  });

  it('combines all selected tags with text, media and status filters without duplicate results', async () => {
    const a = await addEntry('The moon', 'book', 'completed');
    const b = await addEntry('The moon game', 'game', 'completed');
    const c = await addEntry('Another book');
    const [first, second] = repo.tags();
    repo.setTags(a.id, [first.id, second.id]); repo.setTags(b.id, [first.id]); repo.setTags(c.id, [second.id]);
    const one = await api.get('/api/entries').query({ tagIds: first.id }).expect(200);
    expect(one.body.totalResults).toBe(2);
    const both = await api.get('/api/entries').query({ tagIds: [first.id, second.id].join(','), query: 'moon', mediaType: 'book', status: 'completed', sort: 'title_asc' }).expect(200);
    expect(both.body.entries.map((entry: { id: string }) => entry.id)).toEqual([a.id]);
    expect(both.body.summary.total).toBe(3);
    const byName = await api.get('/api/entries').query({ query: 'hidden gems' }).expect(200);
    expect(byName.body.totalResults).toBe(2);
    expect((await api.get('/api/entries').query({ tagIds: randomUUID() }).expect(200)).body.totalResults).toBe(0);
  });

  it('paginates tagged results and treats wildcard characters in tag text literally', async () => {
    const { tag } = repo.createTag('100%_club');
    for (let index = 0; index < 26; index++) repo.setTags((await addEntry(`Title ${String(index).padStart(2, '0')}`)).id, [tag.id]);
    await addEntry('Untagged');
    const result = await api.get('/api/entries').query({ tagIds: tag.id, query: '%_', page: 99, sort: 'title_asc' }).expect(200);
    expect(result.body).toMatchObject({ totalResults: 26, totalPages: 2, page: 2, summary: { total: 27 } });
    expect(result.body.entries).toHaveLength(2);
  });

  it('renames tags everywhere, rejects conflicting names, and deleting one preserves entries and other tags', async () => {
    const entry = await addEntry('A book');
    const [first, second] = repo.tags(); repo.setTags(entry.id, [first.id, second.id]);
    await api.patch('/api/entries/tags/' + first.id).send({ name: '  Loved  ' }).expect(200);
    expect(repo.get(entry.id)?.tags.map((tag) => tag.name)).toContain('Loved');
    await api.patch('/api/entries/tags/' + first.id).send({ name: second.name.toUpperCase() }).expect(409);
    expect(repo.get(entry.id)?.tags.map((tag) => tag.name)).toContain('Loved');
    await api.delete('/api/entries/tags/' + first.id).expect(200);
    await api.delete('/api/entries/tags/' + first.id).expect(200);
    expect(repo.get(entry.id)?.tags).toEqual([second]);
    expect(repo.list({}).totalResults).toBe(1);
  });

  it('keeps existing assignments when an update contains an unknown tag and preserves tags through restore', async () => {
    const entry = await addEntry('A book'); const [tag] = repo.tags(); repo.setTags(entry.id, [tag.id]);
    await api.patch(`/api/entries/${entry.id}/tags`).send({ tagIds: [randomUUID()] }).expect(404);
    expect(repo.get(entry.id)?.tags).toEqual([tag]);
    await api.delete('/api/entries/' + entry.id).expect(200);
    await api.patch(`/api/entries/${entry.id}/tags`).send({ tagIds: [] }).expect(404);
    expect(repo.list({ tagIds: [tag.id] }).totalResults).toBe(0);
    await api.post(`/api/entries/${entry.id}/restore`).send({}).expect(200);
    expect(repo.get(entry.id)?.tags).toEqual([tag]);
    await api.patch(`/api/entries/${randomUUID()}/tags`).send({ tagIds: [] }).expect(404);
    await api.patch(`/api/entries/tags/${randomUUID()}`).send({ name: 'Missing' }).expect(404);
  });

  it.each([{ name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, { name: 12 }, { name: 'test', extra: true }, { name: '\u200b' }])('rejects invalid tag names %j', async (body) => {
    await api.post('/api/entries/tags').send(body).expect(400);
    await api.patch('/api/entries/tags/' + repo.tags()[0].id).send(body).expect(400);
  });

  it('validates assignments, query IDs, and write request protections', async () => {
    const entry = await addEntry('A book'); const tag = repo.tags()[0];
    for (const body of [{ tagIds: ['bad'] }, { tagIds: [randomUUID(), 3] }, { tagIds: Array(51).fill(tag.id) }, { tagIds: [] , extra: true }, {}]) {
      await api.patch(`/api/entries/${entry.id}/tags`).send(body).expect(400);
    }
    for (const tagIds of ['', 'bad', Array(51).fill(tag.id).join(',')]) await api.get('/api/entries').query({ tagIds }).expect(400);
    await api.post('/api/entries/tags').set('Sec-Fetch-Site', 'cross-site').send({ name: 'Blocked' }).expect(403);
    await api.post('/api/entries/tags').type('form').send({ name: 'Blocked' }).expect(415);
    await api.delete('/api/entries/tags/not-an-id').expect(400);
  });

  it('persists tags and assignments after reopening without recreating removed defaults', async () => {
    const filename = join(tmpdir(), 'libra-tags-' + randomUUID() + '.sqlite');
    let persistent = openLibraryDatabase(filename, migrations);
    try {
      let library = new EntriesRepository(persistent);
      const entry = library.createManual({ requestId: randomUUID(), mediaType: 'book', title: 'Local book', originalTitle: '', description: '', releaseDate: null, coverUrl: null, websiteUrl: null, status: 'planned', details: {} }).entry;
      const [first, second] = library.tags();
      library.renameTag(first.id, 'My favorites'); library.deleteTag(second.id);
      const custom = library.createTag('Weekend').tag;
      library.setTags(entry.id, [first.id, custom.id]);
      persistent.close(); persistent = openLibraryDatabase(filename, migrations); library = new EntriesRepository(persistent);
      expect(library.tags()).toHaveLength(4);
      expect(library.tags().some((tag) => tag.id === second.id)).toBe(false);
      expect(library.get(entry.id)?.tags.map((tag) => tag.name)).toEqual(['My favorites', 'Weekend']);
    } finally {
      persistent.close();
      for (const path of [filename, filename + '-journal']) if (existsSync(path)) unlinkSync(path);
    }
  });
});
