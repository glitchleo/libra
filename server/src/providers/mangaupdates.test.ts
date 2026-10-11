import { afterEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import type { CatalogSearchRequest } from '@libra/shared/search';
import { createApp } from '../app.js';
import { createProviderRegistry } from './catalog-provider.js';
import { createMangaUpdatesProvider } from './mangaupdates.js';

const request: CatalogSearchRequest = { provider: 'mangaupdates', query: 'Solo Leveling', mediaType: 'manhwa', page: 1 };
const series = {
  series_id: 15180124327, title: 'Solo Leveling', type: 'Manhwa', year: '2018',
  url: 'https://www.mangaupdates.com/series/6z1uqw7/solo-leveling',
  description: 'A **hunter** follows his dream.\n[Official translation](https://example.com/book)',
  image: { url: { original: 'https://cdn.mangaupdates.com/image/i515366.jpg' } },
  bayesian_rating: 8.47, rating_votes: 2305,
};
const payload = (records: unknown[] = [series]) => ({ total_hits: 76, page: 1, per_page: 25, results: records.map(record => ({ record })) });
const mockFetch = (body: unknown = payload(), status = 200) => vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body, { status }));
afterEach(() => vi.useRealTimers());

describe('MangaUpdates provider', () => {
  it('searches the public API without credentials and normalizes its metadata', async () => {
    const fetcher = mockFetch();
    const provider = createMangaUpdatesProvider(fetcher, 0);
    const result = await provider.search({ ...request, page: 2, year: 2018 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.mangaupdates.com/v1/series/search');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Libra/0.1.0' });
    expect(JSON.parse(String(init?.body))).toEqual({
      search: 'Solo Leveling', stype: 'title', type: ['Manhwa'], year: '2018',
      page: 2, perpage: 25, orderby: 'score', exclude_genre: ['Adult', 'Hentai', 'Smut'],
    });
    expect(result).toMatchObject({ totalPages: 4, totalResults: 76, page: 1 });
    expect(result.results[0]).toEqual({
      provider: 'mangaupdates', sourceId: '15180124327', mediaType: 'manhwa', title: 'Solo Leveling', originalTitle: 'Solo Leveling',
      overview: 'A hunter follows his dream.\nOfficial translation', releaseDate: '2018',
      posterUrl: series.image.url.original, rating: 8.47, voteCount: 2305, externalUrl: series.url,
    });
    expect(provider.info).toMatchObject({ configured: true, requiresCredentials: false, mediaTypes: ['manhwa', 'manhua', 'webtoon', 'manga'] });
  });

  it.each([['manga', 'Manga'], ['manhua', 'Manhua']])('uses the %s native type and adult setting', async (mediaType, type) => {
    const fetcher = mockFetch(payload([{ ...series, type }]));
    const result = await createMangaUpdatesProvider(fetcher, 0).search({ ...request, mediaType: mediaType as 'manga' | 'manhua', includeAdult: true });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ type: [type] });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('exclude_genre');
    expect(result.results[0].mediaType).toBe(mediaType);
  });

  it('searches the webtoon format without changing manga/manhwa/manhua library identities', async () => {
    const fetcher = mockFetch(payload([series, { ...series, series_id: 2, type: 'OEL' }, { ...series, series_id: 3, type: 'Manhua' }]));
    const result = await createMangaUpdatesProvider(fetcher, 0).search({ ...request, mediaType: 'webtoon' });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ category: ['Webtoon/Webcomic'] });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('type');
    expect(result.mediaType).toBe('webtoon');
    expect(result.results.map(item => item.mediaType)).toEqual(['manhwa', 'webtoon', 'manhua']);
  });

  it('uses the returned per_page for pagination, including empty results', async () => {
    const fetcher = mockFetch({ ...payload([]), per_page: 50, total_hits: 1001 });
    expect((await createMangaUpdatesProvider(fetcher, 0).search(request)).totalPages).toBe(21);
    fetcher.mockResolvedValue(Response.json({ ...payload([]), total_hits: 0 }));
    expect(await createMangaUpdatesProvider(fetcher, 0).search(request)).toMatchObject({ results: [], totalResults: 0, totalPages: 0 });
  });

  it('removes complete markdown URLs containing nested and escaped parentheses', async () => {
    const description = '**Translations:** [Complete] [Webnovel](https://www.webnovel.com/comic/Solo-Leveling(only-i-level-up)_15227640605485101) and [Another](https://example.com/a(b(c)d)e).\n[Escaped](https://example.com/a\\(b\\)) ![Cover](https://example.com/cover.jpg)';
    const result = await createMangaUpdatesProvider(mockFetch(payload([{ ...series, description }])), 0).search(request);
    expect(result.results[0].overview).toBe('Translations: [Complete] Webnovel and Another.\nEscaped Cover');
  });

  it('handles missing metadata and unsafe links with a safe canonical fallback', async () => {
    const fetcher = mockFetch(payload([{ series_id: 15180124327, title: 'Solo Leveling', type: 'Manhwa', year: 'N/A',
      url: 'https://evil.example/series/6z1uqw7', image: { url: { original: 'https://secret@cdn.mangaupdates.com/image/a.jpg', thumb: 'https://cdn.mangaupdates.com/image/thumb/a.jpg' } },
      bayesian_rating: 6.5, rating_votes: 0, description: '<b>A hunter</b><br>Dreams &amp; hopes',
    }]));
    expect((await createMangaUpdatesProvider(fetcher, 0).search(request)).results[0]).toMatchObject({
      overview: 'A hunter\nDreams & hopes', releaseDate: null, rating: null, voteCount: 0,
      posterUrl: 'https://cdn.mangaupdates.com/image/thumb/a.jpg', externalUrl: 'https://www.mangaupdates.com/series/6z1uqw7',
    });
    fetcher.mockResolvedValue(Response.json(payload([{ series_id: 1, title: 'A comic', type: 'Manhwa' }])));
    expect((await createMangaUpdatesProvider(fetcher, 0).search(request)).results[0]).toMatchObject({ posterUrl: null, rating: null, voteCount: 0, overview: '', releaseDate: null });
  });

  it('coalesces duplicate searches, caches for five minutes, and distinguishes page/year/adult/type', async () => {
    vi.useFakeTimers();
    const fetcher = mockFetch();
    const provider = createMangaUpdatesProvider(fetcher, 0);
    const [first, second] = await Promise.all([provider.search(request), provider.search(request)]);
    expect(first).toBe(second);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.search({ ...request, page: 2 });
    await provider.search({ ...request, year: 2018 });
    await provider.search({ ...request, includeAdult: true });
    await provider.search({ ...request, mediaType: 'webtoon' });
    expect(fetcher).toHaveBeenCalledTimes(5);
    vi.setSystemTime(Date.now() + 300_001);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('spaces concurrent requests by at least one second', async () => {
    const starts: number[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { starts.push(Date.now()); return Response.json(payload()); });
    const provider = createMangaUpdatesProvider(fetcher);
    await Promise.all([provider.search(request), provider.search({ ...request, page: 2 })]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(990);
  });

  it.each(['seconds', 'date', 'missing'])('honors Retry-After (%s) and rejects queued work during cooldown', async format => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 9, 11);
    vi.setSystemTime(now);
    const waitMs = format === 'missing' ? 2000 : 60_000;
    const headers: Record<string, string> = format === 'missing' ? {} : { 'Retry-After': format === 'seconds' ? '60' : new Date(now + waitMs).toUTCString() };
    const fetcher = mockFetch();
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 429, headers }));
    const provider = createMangaUpdatesProvider(fetcher, 0);
    const results = await Promise.allSettled([provider.search(request), provider.search({ ...request, page: 2 })]);
    for (const result of results) expect(result).toMatchObject({ status: 'rejected', reason: { code: 'PROVIDER_RATE_LIMITED' } });
    vi.setSystemTime(now + waitMs - 1);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + waitMs);
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 76 });
  });

  it.each([[403, 'PROVIDER_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_ERROR'], [504, 'PROVIDER_TIMEOUT']])('handles upstream HTTP %s with safe errors', async (status, code) => {
    const app = createApp(createProviderRegistry([createMangaUpdatesProvider(mockFetch({ message: 'private details' }, status as number), 0)]));
    const result = await supertest(app).get('/api/search').query(request);
    expect(result.body.error.code).toBe(code);
    expect(result.text).not.toContain('private details');
  });

  it.each([null, {}, { ...payload(), per_page: 0 }, { ...payload(), total_hits: -1 },
    payload([{ ...series, series_id: 1.5 }]), payload([{ ...series, title: ' ' }]),
    payload([{ ...series, type: 'Novel' }]), payload([{ ...series, bayesian_rating: 11 }]),
  ])('rejects malformed or incorrect-type responses: %j', async body => {
    await expect(createMangaUpdatesProvider(mockFetch(body), 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('handles network/body timeouts and recovers from errors without caching them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret details'));
    const provider = createMangaUpdatesProvider(fetcher, 0);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.not.stringContaining('secret') });
    fetcher.mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    fetcher.mockResolvedValue(new Response('not JSON'));
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new DOMException('Aborted', 'AbortError'); } } as unknown as Response);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    fetcher.mockResolvedValue(Response.json(payload()));
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 76 });
  });

  it('bounds its queue and rejects expired queued searches', async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const fetcher = mockFetch();
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const provider = createMangaUpdatesProvider(fetcher, 0);
    const pending = Array.from({ length: 8 }, (_, i) => provider.search({ ...request, page: i + 1 }));
    const duplicate = provider.search(request);
    await expect(provider.search({ ...request, page: 9 })).rejects.toMatchObject({ code: 'PROVIDER_BUSY' });
    const settled = Promise.allSettled([...pending, duplicate]);
    vi.setSystemTime(Date.now() + 10_001);
    release(Response.json(payload()));
    const results = await settled;
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ mediaType: 'anime' }, { language: 'en-US' }, { apiKey: 'browser-key' }])('rejects unsupported API input: %j', async overrides => {
    const fetcher = mockFetch();
    const app = createApp(createProviderRegistry([createMangaUpdatesProvider(fetcher, 0)]));
    const result = await supertest(app).get('/api/search').query({ ...request, ...overrides });
    expect(result.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
