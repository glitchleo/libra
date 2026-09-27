import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CatalogItem } from '@libra/shared/search';
import { openLibraryDatabase } from '../../db/database.js';
import { createApp } from '../../app.js';
import { createProviderRegistry } from '../../providers/catalog-provider.js';
import { createTmdbProvider } from '../../providers/tmdb.js';
import { createIgdbProvider } from '../../providers/igdb.js';
import { createTenraiProvider } from '../../providers/tenrai.js';
import { createOpenLibraryProvider } from '../../providers/openlibrary.js';
import { EntriesRepository } from './entries.repository.js';
const movie: CatalogItem = {
    provider: 'tmdb', sourceId: '438631', mediaType: 'movie', title: 'Dune', originalTitle: 'Dune',
    overview: 'A science-fiction story.', releaseDate: '2021-09-15', posterUrl: 'https://image.tmdb.org/t/p/w500/dune.jpg',
    rating: 7.8, voteCount: 100, externalUrl: 'https://www.themoviedb.org/movie/438631',
};
const book: CatalogItem = { ...movie, provider: 'openlibrary', sourceId: 'OL893414W', mediaType: 'book', overview: 'By Frank Herbert',
    releaseDate: '1965', posterUrl: 'https://covers.openlibrary.org/b/id/11481354-L.jpg?default=false', externalUrl: 'https://openlibrary.org/works/OL893414W' };
const game: CatalogItem = { ...movie, provider: 'igdb', sourceId: '119133', mediaType: 'game', title: 'Elden Ring',
    posterUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover.jpg', externalUrl: 'https://www.igdb.com/games/elden-ring' };
const anime: CatalogItem = { ...movie, provider: 'tenrai', sourceId: '20', mediaType: 'anime', title: 'Naruto',
    posterUrl: 'https://cdn.myanimelist.net/images/anime/cover.jpg', externalUrl: 'https://myanimelist.net/anime/20' };
const migrations = resolve('database/migrations');
const providers = createProviderRegistry([createTmdbProvider({}), createIgdbProvider({}), createTenraiProvider(), createOpenLibraryProvider()]);
let database: DatabaseSync;
let repository: EntriesRepository;
let api: ReturnType<typeof supertest>;
beforeEach(() => {
    database = openLibraryDatabase(':memory:', migrations);
    repository = new EntriesRepository(database);
    api = supertest(createApp(providers, undefined, repository));
});
afterEach(() => database.close());
describe('saved library API', () => {
    it.each([movie, book, game, anime])('saves $provider metadata and returns it from the library and index', async (item) => {
        const saved = await api.post('/api/entries').send({ item }).expect(201);
        expect(saved.body).toMatchObject({ created: true, entry: { item, status: 'planned', id: expect.any(String), addedAt: expect.any(String) } });
        const list = await api.get('/api/entries').expect(200);
        expect(list.body).toMatchObject({ totalResults: 1, page: 1, totalPages: 1, summary: { total: 1, byStatus: { planned: 1 } } });
        expect(list.body.entries[0]).toEqual(saved.body.entry);
        const index = await api.get('/api/entries/index').expect(200);
        expect(index.body.entries).toEqual([{ id: saved.body.entry.id, provider: item.provider, sourceId: item.sourceId, mediaType: item.mediaType, status: 'planned', tagIds: [] }]);
        expect(index.headers['cache-control']).toBe('no-store');
    });
    it('deduplicates simultaneous saves and preserves personal status and imported metadata', async () => {
        const results = await Promise.all(Array.from({ length: 6 }, () => api.post('/api/entries').send({ item: movie })));
        expect(results.filter((result) => result.status === 201)).toHaveLength(1);
        const id = results[0].body.entry.id;
        expect(new Set(results.map((result) => result.body.entry.id)).size).toBe(1);
        await api.patch('/api/entries/' + id).send({ status: 'completed' }).expect(200);
        const repeated = await api.post('/api/entries').send({ item: { ...movie, title: 'New provider title' }, status: 'planned' }).expect(200);
        expect(repeated.body).toMatchObject({ created: false, entry: { id, status: 'completed', item: { title: 'Dune' } } });
        expect((await repository.list({})).totalResults).toBe(1);
    });
    it('keeps films, series, and books with matching titles or numeric IDs distinct', async () => {
        for (const item of [movie, { ...movie, mediaType: 'tv', externalUrl: 'https://www.themoviedb.org/tv/438631' }, book]) {
            await api.post('/api/entries').send({ item }).expect(201);
        }
        expect((await repository.list({})).totalResults).toBe(3);
    });
    it('updates only personal status, and removal can be restored without losing it', async () => {
        const first = (await api.post('/api/entries').send({ item: movie, status: 'in_progress' })).body.entry;
        const updated = await api.patch('/api/entries/' + first.id).send({ status: 'completed' }).expect(200);
        expect(updated.body.entry.item).toEqual(movie);
        await api.delete('/api/entries/' + first.id).expect(200);
        await api.delete('/api/entries/' + first.id).expect(200);
        expect((await api.get('/api/entries/index')).body.entries).toEqual([]);
        expect((await api.get('/api/entries')).body.summary.total).toBe(0);
        await api.patch('/api/entries/' + first.id).send({ status: 'planned' }).expect(404);
        const restored = await api.post('/api/entries').send({ item: movie }).expect(201);
        expect(restored.body.entry).toMatchObject({ id: first.id, addedAt: first.addedAt, status: 'completed', item: movie });
    });
    it('filters, sorts, escapes search wildcards, and reports unfiltered totals', async () => {
        (await repository.save(movie, 'TMDB', 'completed'));
        (await repository.save(book, 'Open Library', 'in_progress'));
        (await repository.save(game, 'IGDB', 'planned'));
        (await repository.save({ ...movie, sourceId: '123', title: "100% O'Brien_" }, 'TMDB', 'planned'));
        const byAuthor = await api.get('/api/entries').query({ query: 'herbert', mediaType: 'book', status: 'in_progress' }).expect(200);
        expect(byAuthor.body.totalResults).toBe(1);
        expect(byAuthor.body.entries[0].item).toEqual(book);
        expect(byAuthor.body.summary).toEqual({ total: 4, byStatus: { completed: 1, in_progress: 1, planned: 2 } });
        expect((await api.get('/api/entries').query({ query: '%' })).body.totalResults).toBe(1);
        expect((await api.get('/api/entries').query({ query: "O'Brien_" })).body.totalResults).toBe(1);
        expect((await api.get('/api/entries').query({ query: "' OR 1=1 --" })).body.totalResults).toBe(0);
        const sorted = await api.get('/api/entries').query({ sort: 'title_asc' });
        expect(sorted.body.entries.map((entry: {
            item: CatalogItem;
        }) => entry.item.title)).toEqual(["100% O'Brien_", 'Dune', 'Dune', 'Elden Ring']);
    });
    it('paginates and clamps an empty last page after removal', async () => {
        for (let index = 1; index <= 25; index++)
            (await repository.save({ ...movie, sourceId: String(index), title: 'Movie ' + index }, 'TMDB', 'planned'));
        const first = (await api.get('/api/entries')).body;
        const last = (await api.get('/api/entries').query({ page: 2 })).body;
        expect(first.entries).toHaveLength(24);
        expect(last.entries).toHaveLength(1);
        expect(new Set([...first.entries, ...last.entries].map((entry: {
            id: string;
        }) => entry.id)).size).toBe(25);
        await api.delete('/api/entries/' + last.entries[0].id).expect(200);
        const clamped = (await api.get('/api/entries').query({ page: 2 })).body;
        expect(clamped).toMatchObject({ page: 1, totalPages: 1, totalResults: 24 });
        expect(clamped.entries).toHaveLength(24);
    });
    it.each([
        { title: '' }, { sourceId: '../secret' }, { mediaType: 'game' }, { provider: 'unknown' },
        { rating: 20 }, { voteCount: -1 }, { externalUrl: 'javascript:alert(1)' },
        { externalUrl: 'https://evil.example/movie/1' }, { posterUrl: 'https://image.tmdb.org.evil.example/cover.jpg' },
        { externalUrl: 'https://secret@www.themoviedb.org/movie/1' }, { sourceId: 'OL123W' },
    ])('rejects invalid or mismatched imported data: %j', async (changes) => {
        await api.post('/api/entries').send({ item: { ...movie, ...changes } }).expect(400);
        expect((await repository.index())).toEqual([]);
    });
    it('validates status, IDs, JSON, request sizes, and writes from unrelated sites', async () => {
        const id = randomUUID();
        await api.post('/api/entries').send({ item: movie, status: 'invalid' }).expect(400);
        await api.patch('/api/entries/' + id).send({ status: 'completed', title: 'overwrite' }).expect(400);
        await api.patch('/api/entries/' + id).send({ status: 'completed' }).expect(404);
        await api.delete('/api/entries/not-an-id').expect(400);
        await api.post('/api/entries').set('Content-Type', 'text/plain').send('{}').expect(415);
        await api.post('/api/entries').set('Content-Type', 'application/json').send('{broken').expect(400);
        await api.post('/api/entries').send({ item: { ...movie, overview: 'a'.repeat(300000) } }).expect(413);
        await api.post('/api/entries').set('Sec-Fetch-Site', 'cross-site').send({ item: movie }).expect(403);
        expect((await repository.index())).toEqual([]);
    });
    it.each([{ page: 0 }, { sort: 'title; DROP TABLE entries' }, { status: 'anything' }, { mediaType: 'unknown' }, { extra: 'unsupported' }])('validates library filters: %j', async (query) => {
        await api.get('/api/entries').query(query).expect(400);
    });
    it('retains entries and statuses when the file database is closed and reopened, without rerunning migrations', async () => {
        const filename = join(tmpdir(), 'libra-library-' + randomUUID() + '.sqlite');
        let persistent = openLibraryDatabase(filename, migrations);
        try {
            const original = (await new EntriesRepository(persistent).save(book, 'Open Library', 'completed')).entry;
            persistent.close();
            persistent = openLibraryDatabase(filename, migrations);
            expect((await new EntriesRepository(persistent).get(original.id))).toEqual(original);
            expect(persistent.prepare('SELECT count(*) AS count FROM schema_migrations').get()!.count).toBe(3);
        }
        finally {
            persistent.close();
            // Only the uniquely named test database and its possible journal are removed.
            for (const path of [filename, filename + '-journal'])
                if (existsSync(path))
                    unlinkSync(path);
        }
    });
});
describe('manual entry API', () => {
    const input = () => ({ requestId: randomUUID(), mediaType: 'book', title: 'The Lantern Atlas', description: 'A locally published story.', details: { author: 'Mira Example', pages: 144 } });
    it('creates an entry without catalog credentials, saves typed details, and searches its author', async () => {
        const payload = { ...input(), releaseDate: '2024', status: 'completed', websiteUrl: 'https://example.com/atlas' };
        const result = await api.post('/api/entries/manual').send(payload).expect(201);
        expect(result.body).toMatchObject({ created: true, entry: { providerName: 'Manual entry', status: 'completed', details: payload.details, item: { title: payload.title, overview: payload.description, provider: 'manual', sourceId: payload.requestId, mediaType: 'book', rating: null, voteCount: 0, posterUrl: null, releaseDate: '2024', externalUrl: payload.websiteUrl } } });
        const list = await api.get('/api/entries').query({ query: 'mira example', mediaType: 'book' }).expect(200);
        expect(list.body.entries).toEqual([result.body.entry]);
        await api.patch('/api/entries/' + result.body.entry.id).send({ status: 'in_progress' }).expect(200);
        expect((await repository.get(result.body.entry.id))?.details).toEqual(payload.details);
    });
    it.each(['movie', 'tv', 'anime', 'book', 'manga', 'manhwa', 'game', 'audiobook', 'other'])('accepts only a title and type for %s', async (mediaType) => {
        const result = await api.post('/api/entries/manual').send({ requestId: randomUUID(), mediaType, title: '  Unlisted title  ' }).expect(201);
        expect(result.body.entry).toMatchObject({ item: { title: 'Unlisted title', mediaType, overview: '', externalUrl: '', releaseDate: null }, details: {}, status: 'planned' });
    });
    it('deduplicates concurrent retries, even after changing the type, and preserves the first successful save', async () => {
        const payload = input();
        const results = await Promise.all(Array.from({ length: 4 }, () => api.post('/api/entries/manual').send(payload)));
        expect(results.filter((result) => result.status === 201)).toHaveLength(1);
        const first = results[0].body.entry;
        const repeated = await api.post('/api/entries/manual').send({ ...payload, mediaType: 'movie', details: {}, title: 'Changed after a lost response' }).expect(200);
        expect(repeated.body.entry).toEqual(first);
        expect((await repository.index())).toHaveLength(1);
        await api.post('/api/entries/manual').send({ ...payload, requestId: randomUUID() }).expect(201);
        expect((await repository.index())).toHaveLength(2);
    });
    it('restores a removed manual entry with its original metadata and status', async () => {
        const entry = (await api.post('/api/entries/manual').send(input())).body.entry;
        await api.delete('/api/entries/' + entry.id).expect(200);
        expect((await repository.index())).toHaveLength(0);
        const restored = await api.post('/api/entries/' + entry.id + '/restore').send({}).expect(200);
        expect(restored.body.entry).toMatchObject({ id: entry.id, item: entry.item, details: entry.details, status: entry.status });
        await api.post('/api/entries/' + entry.id + '/restore').send({}).expect(200);
        expect((await repository.index())).toHaveLength(1);
        await api.post('/api/entries/' + randomUUID() + '/restore').send({}).expect(404);
        await api.post('/api/entries/not-an-id/restore').send({}).expect(400);
    });
    it.each([
        { title: '   ' }, { mediaType: 'podcast' }, { requestId: 'not-a-uuid' }, { details: { runtimeMinutes: 90 } },
        { details: { pages: -1 } }, { details: { pages: 1.5 } }, { details: { pages: '100' } }, { details: { pages: 100001 } },
        { details: { author: 42 } }, { details: { author: 'a'.repeat(501) } },
        { releaseDate: '2023-02-29' }, { releaseDate: '2024-13-01' }, { releaseDate: 'tomorrow' },
        { coverUrl: 'javascript:alert(1)' }, { coverUrl: 'data:image/png;base64,AAA' },
        { websiteUrl: 'https://password@example.com' }, { provider: 'tmdb' }, { catalogRating: 10 },
    ])('rejects invalid manual metadata: %j', async (changes) => {
        await api.post('/api/entries/manual').send({ ...input(), ...changes }).expect(400);
        expect((await repository.index())).toHaveLength(0);
    });
    it('accepts leap-day dates, fractional game hours, and preserves user text as text', async () => {
        const result = await api.post('/api/entries/manual').send({ ...input(), title: '<script>alert(1)</script>', mediaType: 'game', releaseDate: '2024-02-29', details: { playtimeHours: 1.5, developer: 'Indie collective', platforms: 'PC, Linux' } }).expect(201);
        expect(result.body.entry.details.playtimeHours).toBe(1.5);
        expect(result.body.entry.item.title).toBe('<script>alert(1)</script>');
    });
    it('upgrades an existing SQLite library and retains both imported and manual records after reopening', async () => {
        const filename = join(tmpdir(), 'libra-manual-migration-' + randomUUID() + '.sqlite');
        let persistent = new DatabaseSync(filename);
        try {
            persistent.exec(readFileSync(join(migrations, '001_library.sql'), 'utf8'));
            persistent.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT; INSERT INTO schema_migrations VALUES ('001_library.sql', '2026-09-24');");
            persistent.prepare(`INSERT INTO entries (id, provider, source_id, media_type, provider_name, title, original_title, overview, catalog_vote_count, external_url, status, added_at, updated_at) VALUES (?, 'tmdb', '438631', 'movie', 'TMDB', 'Dune', 'Dune', '', 0, 'https://www.themoviedb.org/movie/438631', 'completed', '2026-09-24', '2026-09-24')`).run(randomUUID());
            persistent.close();
            persistent = openLibraryDatabase(filename, migrations);
            const repo = new EntriesRepository(persistent);
            expect((await repo.list({})).entries[0]).toMatchObject({ item: { title: 'Dune' }, details: {}, status: 'completed' });
            const manual = (await repo.createManual({ ...input(), mediaType: 'book', status: 'planned', originalTitle: '', coverUrl: null, releaseDate: null, websiteUrl: null })).entry;
            persistent.close();
            persistent = openLibraryDatabase(filename, migrations);
            expect((await new EntriesRepository(persistent).get(manual.id))).toEqual(manual);
            expect((await new EntriesRepository(persistent).index())).toHaveLength(2);
        }
        finally {
            persistent.close();
            for (const path of [filename, filename + '-journal'])
                if (existsSync(path))
                    unlinkSync(path);
        }
    });
});
