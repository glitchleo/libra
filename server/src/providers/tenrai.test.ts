import { afterEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { createProviderRegistry } from './catalog-provider.js';
import { createTenraiProvider } from './tenrai.js';
import type { CatalogSearchRequest } from '@libra/shared/search';

const request: CatalogSearchRequest = { provider: 'tenrai', query: 'Naruto', mediaType: 'anime', page: 1 };
const entry = {
  mal_id: 20, titles: [{ type: 'Default', title: 'Naruto' }, { type: 'English', title: 'Naruto English' }, { type: 'Japanese', title: 'ナルト' }],
  synopsis: 'A young ninja follows his dream.', images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/13/17405.jpg' } },
  aired: { from: '2002-10-03T00:00:00+00:00' }, score: 8.1, scored_by: 100,
};
const payload = (data: unknown[] = [entry]) => ({
  pagination: { current_page: 1, last_visible_page: 3, has_next_page: true, items: { total: 45 } }, data,
});
const mockFetch = (body: unknown = payload(), status = 200) => vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body, { status }));

afterEach(() => vi.useRealTimers());

describe('Tenrai provider', () => {
  it('searches anime without auth and normalizes MyAnimeList metadata', async () => {
    const fetcher = mockFetch();
    const provider = createTenraiProvider({}, fetcher, 0);
    const result = await provider.search({ ...request, query: 'Naruto & friends', page: 2 });
    const [value, init] = fetcher.mock.calls[0];
    const url = new URL(String(value));
    expect(url.origin + url.pathname).toBe('https://api.tenrai.org/v1/anime');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'Naruto & friends', page: '2', limit: '20', sfw: '' });
    expect(init?.headers).toEqual({ accept: 'application/json' });
    expect(result.totalResults).toBe(45);
    expect(result.results[0]).toMatchObject({
      provider: 'tenrai', sourceId: '20', mediaType: 'anime', title: 'Naruto English',
      originalTitle: 'ナルト', releaseDate: '2002-10-03', rating: 8.1, voteCount: 100,
      externalUrl: 'https://myanimelist.net/anime/20',
      posterUrl: 'https://cdn.myanimelist.net/images/anime/13/17405.jpg',
    });
    expect(provider.info).toMatchObject({ configured: true, requiresCredentials: false, mediaTypes: ['anime', 'manga'] });
  });

  it('uses the manga endpoint and type filter, published date, and adult setting', async () => {
    const fetcher = mockFetch(payload([{ mal_id: 2, title: 'Berserk', published: { from: '1989-08-25T00:00:00+00:00' }, score: null, scored_by: null }]));
    const result = await createTenraiProvider({}, fetcher, 0).search({ ...request, mediaType: 'manga', includeAdult: true });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/v1/manga');
    expect(url.searchParams.has('sfw')).toBe(false);
    expect(url.searchParams.get('type')).toBe('manga');
    expect(result.results[0]).toMatchObject({ title: 'Berserk', mediaType: 'manga', releaseDate: '1989-08-25', posterUrl: null, rating: null, voteCount: 0, overview: '', externalUrl: 'https://myanimelist.net/manga/2' });
  });

  it('handles unknown dates, missing titles in legacy fields, unsafe images, and zero scores', async () => {
    const fetcher = mockFetch(payload([{ mal_id: 1, titles: [{ type: 'Default', title: 'An anime' }], score: 0, images: { jpg: { image_url: 'javascript:alert(1)' } } }]));
    const result = await createTenraiProvider({}, fetcher, 0).search(request);
    expect(result.results[0]).toMatchObject({ title: 'An anime', originalTitle: 'An anime', posterUrl: null, rating: null, releaseDate: null });
  });

  it('coalesces in-flight searches and caches successes, but not different pages', async () => {
    const fetcher = mockFetch();
    const provider = createTenraiProvider({}, fetcher, 0);
    const [first, second] = await Promise.all([provider.search(request), provider.search(request)]);
    expect(first).toEqual(second);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.search({ ...request, page: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('paces distinct concurrent requests through a shared queue', async () => {
    const starts: number[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      starts.push(Date.now());
      return Response.json(payload());
    });
    const provider = createTenraiProvider({}, fetcher);
    await Promise.all([provider.search(request), provider.search({ ...request, mediaType: 'manga' })]);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(530);
  });

  it('does not cache errors or poison the request queue after a failure', async () => {
    const fetcher = mockFetch();
    fetcher.mockResolvedValueOnce(Response.json({ message: 'Upstream internal detail' }, { status: 500 }));
    const provider = createTenraiProvider({}, fetcher, 0);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 45 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([[401, 'PROVIDER_AUTH_ERROR'], [403, 'PROVIDER_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_ERROR'], [504, 'PROVIDER_TIMEOUT']])('handles upstream %s without echoing its error body', async (status, code) => {
    const provider = createTenraiProvider({}, mockFetch({ error: 'internal trace' }, status as number), 0);
    await expect(provider.search(request)).rejects.toMatchObject({ code });
    await expect(createTenraiProvider({}, mockFetch({ error: 'internal trace' }, status as number), 0).search(request)).rejects.not.toHaveProperty('message', expect.stringContaining('internal trace'));
  });

  it.each([null, {}, payload([{ mal_id: 1 }]), payload([{ ...entry, score: 11 }])])('rejects malformed responses', async (body) => {
    await expect(createTenraiProvider({}, mockFetch(body), 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('maps network failures and timeouts to readable errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('internal networking detail'));
    await expect(createTenraiProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    fetcher.mockRejectedValue(new DOMException('time out', 'TimeoutError'));
    await expect(createTenraiProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('returns empty result pages without fabricating entries', async () => {
    const fetcher = mockFetch({ pagination: { current_page: 1, last_visible_page: 1, has_next_page: false, items: { total: 0 } }, data: [] });
    expect(await createTenraiProvider({}, fetcher, 0).search(request)).toMatchObject({ totalResults: 0, results: [] });
  });

  it('handles Tenrai empty nested objects and unknown values', async () => {
    const fetcher = mockFetch(payload([{ mal_id: 1, title: 'Unknown', titles: [], images: {}, aired: {}, score: 0, scored_by: null }]));
    expect((await createTenraiProvider({}, fetcher, 0).search(request)).results[0])
      .toMatchObject({ title: 'Unknown', posterUrl: null, releaseDate: null, rating: null, voteCount: 0 });
  });

  it('keeps the optional server key in its header and out of metadata, URLs, results, and errors', async () => {
    const fetcher = mockFetch();
    const provider = createTenraiProvider({ serverKey: ' private-server-key ' }, fetcher, 0);
    const app = createApp(createProviderRegistry([provider]));
    const metadata = await supertest(app).get('/api/search/providers');
    const response = await supertest(app).get('/api/search').query(request);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ accept: 'application/json', 'X-Server-Key': 'private-server-key' });
    expect(String(fetcher.mock.calls[0][0])).not.toContain('private-server-key');
    expect(metadata.text + response.text).not.toContain('private-server-key');
    fetcher.mockRejectedValue(new Error('private-server-key'));
    const error = await supertest(app).get('/api/search').query({ ...request, page: 2 });
    expect(error.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.text).not.toContain('private-server-key');
  });

  it('uses public access for a blank key and faster pacing for a server key', async () => {
    const publicFetch = mockFetch();
    await createTenraiProvider({ serverKey: ' ' }, publicFetch, 0).search(request);
    expect(publicFetch.mock.calls[0][1]?.headers).toEqual({ accept: 'application/json' });
    const starts: number[] = [];
    const keyedFetch = mockFetch();
    keyedFetch.mockImplementation(async () => { starts.push(Date.now()); return Response.json(payload()); });
    const provider = createTenraiProvider({ serverKey: 'key' }, keyedFetch);
    await Promise.all([provider.search(request), provider.search({ ...request, mediaType: 'manga' })]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(195);
  });

  it.each(['seconds', 'date', 'missing', 'invalid'])('honors Retry-After (%s), rejects queued requests, and permits a retry after cooldown', async (format) => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 8, 21, 12);
    vi.setSystemTime(now);
    const waitMs = ['missing', 'invalid'].includes(format) ? 2000 : 60_000;
    const headers: Record<string, string> = format === 'missing' ? {} : { 'Retry-After': format === 'seconds' ? '60'
      : format === 'date' ? new Date(now + waitMs).toUTCString() : 'invalid' };
    const fetcher = mockFetch();
    fetcher.mockResolvedValueOnce(Response.json({ message: 'Slow down' }, { status: 429, headers }));
    const provider = createTenraiProvider({}, fetcher, 0);
    const results = await Promise.allSettled([provider.search(request), provider.search({ ...request, page: 2 })]);
    for (const result of results) expect(result).toMatchObject({ status: 'rejected', reason: { code: 'PROVIDER_RATE_LIMITED' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + waitMs - 1);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + waitMs);
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 45 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not mistake an aborted response body for malformed JSON', async () => {
    const fetcher = mockFetch();
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new DOMException('Aborted', 'AbortError'); } } as unknown as Response);
    await expect(createTenraiProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    fetcher.mockResolvedValue(new Response('not JSON'));
    await expect(createTenraiProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('exposes Tenrai through the API without environment credentials and rejects unsupported filters', async () => {
    const fetcher = mockFetch();
    const app = createApp(createProviderRegistry([createTenraiProvider({}, fetcher, 0)]));
    const info = await supertest(app).get('/api/search/providers');
    expect(info.body.providers[0]).toMatchObject({ id: 'tenrai', configured: true, requiresCredentials: false });
    const oldProvider = await supertest(app).get('/api/search').query({ ...request, provider: 'jikan' });
    expect(oldProvider.body.error.code).toBe('UNKNOWN_PROVIDER');
    const response = await supertest(app).get('/api/search').query(request);
    expect(response.status).toBe(200);
    expect(response.body.results[0].provider).toBe('tenrai');
    for (const invalid of [{ language: 'en-US' }, { year: 2002 }, { mediaType: 'movie' }]) {
      const rejected = await supertest(app).get('/api/search').query({ ...request, ...invalid });
      expect(rejected.status).toBe(400);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
