import { afterEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { createProviderRegistry } from './catalog-provider.js';
import { createIgdbProvider } from './igdb.js';
import type { CatalogSearchRequest } from '@libra/shared/search';

const credentials = { clientId: 'private-client-id', accessToken: 'private-access-token' };
const request: CatalogSearchRequest = { provider: 'igdb', query: 'Elden Ring', mediaType: 'game', page: 1 };
const game = {
  id: 119133, name: 'Elden Ring', slug: 'elden-ring', summary: 'Explore the Lands Between.',
  first_release_date: 1645747200, cover: { image_id: 'co4jni' }, total_rating: 92, total_rating_count: 100,
};
// Match the live /games array and /games/count object, rather than a synthetic multiquery response.
const mockFetch = (games: unknown = [game], total: unknown = { count: 21 }) => vi.fn<typeof fetch>()
  .mockImplementation(async (url) => Response.json(String(url).endsWith('/games/count') ? total : games));
const api = (fetcher = mockFetch(), config = credentials) => createApp(createProviderRegistry([createIgdbProvider(config, fetcher, 0)]));

afterEach(() => vi.useRealTimers());

describe('IGDB provider', () => {
  it('authenticates server-side and normalizes games with matching totals and year filters', async () => {
    const fetcher = mockFetch();
    const result = await createIgdbProvider({ clientId: ' private-client-id ', accessToken: ' private-access-token ' }, fetcher, 0)
      .search({ ...request, year: 2022, page: 2 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.igdb.com/v4/games');
    expect(init).toMatchObject({ method: 'POST', headers: {
      'Client-ID': credentials.clientId, Authorization: 'Bearer ' + credentials.accessToken,
      Accept: 'application/json', 'Content-Type': 'text/plain',
    } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = String(init?.body);
    expect(body).toContain('limit 20; offset 20;');
    expect(body).toContain('search "Elden Ring";');
    expect(body).toContain('where first_release_date >= 1640995200 & first_release_date < 1672531200;');
    const [countUrl, countInit] = fetcher.mock.calls[1];
    expect(countUrl).toBe('https://api.igdb.com/v4/games/count');
    expect(countInit).toMatchObject({ method: 'POST', headers: init?.headers,
      body: 'search "Elden Ring"; where first_release_date >= 1640995200 & first_release_date < 1672531200;' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ provider: 'igdb', mediaType: 'game', page: 2, totalPages: 2, totalResults: 21 });
    expect(result.results[0]).toEqual({
      provider: 'igdb', sourceId: '119133', mediaType: 'game', title: 'Elden Ring', originalTitle: 'Elden Ring',
      overview: 'Explore the Lands Between.', releaseDate: '2022-02-25',
      posterUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
      rating: 9.2, voteCount: 100, externalUrl: 'https://www.igdb.com/games/elden-ring',
    });
  });

  it('escapes quotes, backslashes, and control characters in APICalypse searches', async () => {
    const fetcher = mockFetch();
    const query = 'Halo\\"; }; query games "injected" { limit 500; };\n';
    await createIgdbProvider(credentials, fetcher, 0).search({ ...request, query });
    const body = fetcher.mock.calls.map(([, init]) => String(init?.body)).join('\n');
    const strings = [...body.matchAll(/search ("(?:[^"\\]|\\.)*");/g)];
    expect(strings).toHaveLength(2);
    for (const match of strings) expect(JSON.parse(match[1])).toBe(query.replace('\n', ' '));
    expect(body).not.toContain('where ');
  });

  it('handles absent metadata, zero ratings, empty results, and the page cap', async () => {
    const result = await createIgdbProvider(credentials, mockFetch([{ id: 1, name: 'Future game', slug: 'future-game', storyline: 'Story' }], { count: 10001 }), 0).search(request);
    expect(result.totalPages).toBe(500);
    expect(result.results[0]).toMatchObject({ overview: 'Story', releaseDate: null, posterUrl: null, rating: null, voteCount: 0 });
    const zero = await createIgdbProvider(credentials, mockFetch([{ ...game, total_rating: 0, first_release_date: 0, cover: { image_id: '../untrusted' } }]), 0).search(request);
    expect(zero.results[0]).toMatchObject({ rating: 0, releaseDate: '1970-01-01', posterUrl: null });
    const empty = await createIgdbProvider(credentials, mockFetch([], { count: 0 }), 0).search(request);
    expect(empty).toMatchObject({ results: [], totalResults: 0, totalPages: 0 });
  });

  it('bypasses the multiquery endpoint that returned an empty array for a valid live search', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/multiquery')) return Response.json([]);
      if (String(url).endsWith('/games/count')) return Response.json({ count: 27 });
      return Response.json([{ id: 119133, name: 'Elden Ring', slug: 'elden-ring' }]);
    });
    const result = await createIgdbProvider(credentials, fetcher, 0).search(request);
    expect(result.totalResults).toBe(27);
    expect(result.results[0].title).toBe('Elden Ring');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.igdb.com/v4/games', 'https://api.igdb.com/v4/games/count']);
  });

  it.each([{}, { clientId: 'id' }, { accessToken: 'token' }, { clientId: ' ', accessToken: 'token' }])('requires both credentials: %j', async (config) => {
    const fetcher = mockFetch();
    const provider = createIgdbProvider(config, fetcher, 0);
    expect(provider.info.configured).toBe(false);
    await expect(provider.search(request)).rejects.toMatchObject({ status: 503, code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[401, 'PROVIDER_AUTH_ERROR'], [403, 'PROVIDER_AUTH_ERROR'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_ERROR'], [504, 'PROVIDER_TIMEOUT']])('handles HTTP %s without exposing upstream errors', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-access-token upstream trace', { status: status as number }));
    const response = await supertest(api(fetcher)).get('/api/search').query(request);
    expect(response.body.error.code).toBe(code);
    expect(response.text).not.toMatch(/private-access-token|upstream trace/);
    if (status === 401) expect(response.body.error.message).toContain('generate a new one');
  });

  it.each([
    null, {}, [{ name: 'games', result: [] }], [{ ...game, name: ' ' }],
    [{ ...game, total_rating: 101 }], [{ ...game, first_release_date: 1e20 }],
  ])('rejects malformed game data before fetching totals: %j', async (body) => {
    const fetcher = mockFetch(body);
    await expect(createIgdbProvider(credentials, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], {}, { count: -1 }, { count: 1.5 }, { count: '27' }])('rejects malformed result counts: %j', async (total) => {
    await expect(createIgdbProvider(credentials, mockFetch([game], total), 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('does not cache a page when the count request fails, and recovers on retry', async () => {
    const fetcher = mockFetch();
    fetcher.mockResolvedValueOnce(Response.json([game])).mockResolvedValueOnce(new Response('private-access-token', { status: 500 }));
    const provider = createIgdbProvider(credentials, fetcher, 0);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 21 });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('handles network failures, timeouts, and invalid JSON without leaking credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private-access-token'));
    const response = await supertest(api(fetcher)).get('/api/search').query(request);
    expect(response.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(response.text).not.toContain('private-access-token');
    fetcher.mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
    await expect(createIgdbProvider(credentials, fetcher, 0).search(request)).rejects.toMatchObject({ status: 504, code: 'PROVIDER_TIMEOUT' });
    fetcher.mockResolvedValue(new Response('not json'));
    await expect(createIgdbProvider(credentials, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new DOMException('Aborted body', 'AbortError'); } } as unknown as Response);
    await expect(createIgdbProvider(credentials, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('coalesces identical requests, caches briefly, and separates pages and year filters', async () => {
    vi.useFakeTimers();
    const fetcher = mockFetch();
    const provider = createIgdbProvider(credentials, fetcher, 0);
    const [first, second] = await Promise.all([provider.search(request), provider.search(request)]);
    expect(first).toBe(second);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await provider.search({ ...request, page: 2 });
    await provider.search({ ...request, year: 2022 });
    expect(fetcher).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(60_001);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it('paces requests and recovers the queue after an upstream failure', async () => {
    const starts: number[] = [];
    const fetcher = mockFetch();
    fetcher.mockImplementation(async (url) => {
      starts.push(Date.now());
      return Response.json(starts.length === 1 ? { error: 'failure' } : String(url).endsWith('/games/count') ? { count: 21 } : [game], { status: starts.length === 1 ? 500 : 200 });
    });
    const provider = createIgdbProvider(credentials, fetcher);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await provider.search(request);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(280);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(280);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('bounds the request queue while still sharing an already queued search', async () => {
    let release!: (value: Response) => void;
    const fetcher = mockFetch();
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const provider = createIgdbProvider(credentials, fetcher, 0);
    const searches = Array.from({ length: 12 }, (_, i) => provider.search({ ...request, page: i + 1 }));
    const duplicate = provider.search(request);
    await expect(provider.search({ ...request, page: 13 })).rejects.toMatchObject({ code: 'PROVIDER_BUSY' });
    release(Response.json([game]));
    await Promise.all([...searches, duplicate]);
    expect(fetcher).toHaveBeenCalledTimes(24);
  });
});

describe('IGDB search API', () => {
  it('lists IGDB with game capabilities and no private credentials', async () => {
    const response = await supertest(api()).get('/api/search/providers');
    expect(response.status).toBe(200);
    expect(response.body.providers[0]).toMatchObject({
      id: 'igdb', name: 'IGDB', configured: true, requiresCredentials: true,
      mediaTypes: ['game'], filters: { year: true, language: false, includeAdult: false },
    });
    expect(response.text).not.toContain(credentials.clientId);
    expect(response.text).not.toContain(credentials.accessToken);
  });

  it.each([{ mediaType: 'movie' }, { language: 'en-US' }, { includeAdult: 'true' }, { page: 501 }, { access_token: 'client-token' }])('rejects unsupported input before contacting IGDB: %j', async (overrides) => {
    const fetcher = mockFetch();
    const response = await supertest(api(fetcher)).get('/api/search').query({ ...request, ...overrides });
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns normalized games through the API', async () => {
    const response = await supertest(api()).get('/api/search').query({ ...request, year: 2022 });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.results[0]).toMatchObject({ sourceId: '119133', mediaType: 'game', title: 'Elden Ring' });
    expect(response.text).not.toContain(credentials.accessToken);
  });
});
