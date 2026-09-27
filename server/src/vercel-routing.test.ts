import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertRewrites } from '@vercel/routing-utils';
import supertest from 'supertest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import vercelConfig from '../../vercel.json';
import { createApp } from './app.js';
import { openLibraryDatabase } from './db/database.js';
import { EntriesRepository } from './modules/entries/entries.repository.js';
import { createProviderRegistry, type CatalogProvider } from './providers/catalog-provider.js';

// Compile the real deployment config. Named rewrite captures can become query
// parameters even though the browser never sent them.
const routes = convertRewrites(vercelConfig.rewrites).map(route => {
  if (!('src' in route) || typeof route.src !== 'string' || typeof route.dest !== 'string') throw new Error('Expected a rewrite destination');
  return { pattern: new RegExp(route.src), destination: route.dest };
});
function rewrite(requestUrl: string) {
  const original = new URL(requestUrl, 'https://libra.example');
  for (const route of routes) {
    const match = route.pattern.exec(original.pathname);
    if (!match) continue;
    const destination = new URL(route.destination.replace(/\$(\d+)/g, (_token, index: string) => encodeURIComponent(match[Number(index)] ?? '')), original);
    for (const [key, value] of destination.searchParams) original.searchParams.set(key, value);
    // Vercel's Node function receives the original path and merged query.
    return { destination: destination.pathname, requestUrl: original.pathname + original.search };
  }
  return undefined;
}

const search = vi.fn<CatalogProvider['search']>();
const providers = createProviderRegistry([{
  info: {
    id: 'tmdb', name: 'TMDB', description: 'Test catalog', website: 'https://www.themoviedb.org',
    configured: true, mediaTypes: ['movie'], filters: { year: true, language: true, includeAdult: true },
  },
  search,
}]);
let database: DatabaseSync;
let api: ReturnType<typeof supertest>;
let cookie: string;

beforeEach(async () => {
  search.mockImplementation(async input => ({
    provider: input.provider, query: input.query, mediaType: input.mediaType,
    page: input.page, totalPages: 0, totalResults: 0, results: [],
  }));
  database = openLibraryDatabase(':memory:', resolve('database/migrations'));
  const app = createApp(providers, undefined, new EntriesRepository(database), { password: 'routing-test-passphrase', secure: true });
  api = supertest(createServer((req, res) => {
    const rewritten = rewrite(req.url ?? '/');
    if (rewritten?.destination !== '/api') { res.writeHead(404).end(); return; }
    req.url = rewritten.requestUrl;
    app(req, res);
  }));
  const login = await api.post('/api/auth/login').send({ password: 'routing-test-passphrase' }).expect(200);
  cookie = login.headers['set-cookie'][0].split(';')[0];
});
afterEach(() => database.close());

describe('Vercel API rewrites', () => {
  it('preserves search filters without adding route parameters', async () => {
    const filters = { provider: 'tmdb', query: 'Dune & friends / 日本語', mediaType: 'movie', page: '2', year: '2021', language: 'en-US', includeAdult: 'false' };
    const response = await api.get('/api/search').set('Cookie', cookie).query(filters).expect(200);
    expect(response.body).toMatchObject({ query: filters.query, page: 2 });
    expect(search).toHaveBeenCalledWith({ ...filters, page: 2, year: 2021, includeAdult: false });
  });

  it('shows a saved custom entry in the library and keeps tag and status filters working', async () => {
    const tag = (await api.post('/api/entries/tags').set('Cookie', cookie).send({ name: 'Niche favorites' }).expect(201)).body.tag;
    const saved = await api.post('/api/entries/manual').set('Cookie', cookie).send({
      requestId: randomUUID(), title: 'The Lantern Atlas', mediaType: 'book', status: 'completed', tagIds: [tag.id],
      details: { author: 'Mira Example' },
    }).expect(201);
    const list = await api.get('/api/entries').set('Cookie', cookie).expect(200);
    expect(list.body.entries).toEqual([saved.body.entry]);
    const filtered = await api.get('/api/entries').set('Cookie', cookie).query({
      query: 'mira example', mediaType: 'book', status: 'completed', sort: 'title_asc', page: '1', tagIds: tag.id,
    }).expect(200);
    expect(filtered.body.entries).toEqual([saved.body.entry]);
    const index = await api.get('/api/entries/index').set('Cookie', cookie).expect(200);
    expect(index.body.entries).toEqual([expect.objectContaining({ id: saved.body.entry.id, tagIds: [tag.id] })]);
    const updated = await api.patch('/api/entries/' + saved.body.entry.id).set('Cookie', cookie).send({ status: 'in_progress' }).expect(200);
    expect(updated.body.entry.status).toBe('in_progress');
    const completed = await api.get('/api/entries').set('Cookie', cookie).query({ status: 'completed' }).expect(200);
    expect(completed.body.entries).toEqual([]);
  });

  it('still rejects invalid filters and requires sign-in', async () => {
    await api.get('/api/entries').expect(401);
    await api.get('/api/search').expect(401);
    for (const query of [{ page: 0 }, { page: ['1', '2'] }, { extra: 'unsupported' }]) {
      await api.get('/api/entries').set('Cookie', cookie).query(query).expect(400);
      await api.get('/api/search').set('Cookie', cookie).query({ provider: 'tmdb', query: 'Dune', mediaType: 'movie', ...query }).expect(400);
    }
    expect(search).not.toHaveBeenCalled();
    await api.get('/api/does-not-exist').set('Cookie', cookie).expect(404);
  });

  it('keeps website pages separate from API routes and built assets', () => {
    expect(rewrite('/library')?.destination).toBe('/index.html');
    expect(rewrite('/settings')?.destination).toBe('/index.html');
    expect(rewrite('/assets/index.js')).toBeUndefined();
    expect(rewrite('/api/auth')?.destination).toBe('/api');
  });
});
