import { afterEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import type { CatalogSearchRequest } from '@libra/shared/search';
import { createApp } from '../app.js';
import { createProviderRegistry } from './catalog-provider.js';
import { createOpenLibraryProvider } from './openlibrary.js';

const request: CatalogSearchRequest = { provider: 'openlibrary', query: 'Dune', mediaType: 'book', page: 1 };
// Matches a live, explicitly field-selected /search.json response.
const book = {
  key: '/works/OL893414W', title: 'Dune', author_name: ['Frank Herbert'],
  first_publish_year: 1965, cover_i: 11481354, ratings_average: 4.3, ratings_count: 444,
};
const payload = (docs: unknown[] = [book], numFound = 21, start = 0) => ({ numFound, num_found: numFound, start, docs });
const mockFetch = (body: unknown = payload(), status = 200) => vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body, { status }));

afterEach(() => vi.useRealTimers());

describe('Open Library provider', () => {
  it('searches without auth, requests only needed fields, and maps works, authors, covers, and five-star ratings', async () => {
    const fetcher = mockFetch(payload([book], 21, 20));
    const result = await createOpenLibraryProvider({}, fetcher, 0).search({ ...request, page: 2, year: 1965 });
    const [input, init] = fetcher.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://openlibrary.org/search.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      title: 'Dune', q: 'first_publish_year:1965', limit: '20', page: '2',
      fields: 'key,title,author_name,first_publish_year,cover_i,ratings_average,ratings_count',
    });
    expect(init?.headers).toEqual({ Accept: 'application/json', 'User-Agent': 'Libra/0.1.0' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ provider: 'openlibrary', mediaType: 'book', page: 2, totalResults: 21, totalPages: 2 });
    expect(result.results[0]).toEqual({
      provider: 'openlibrary', sourceId: 'OL893414W', title: 'Dune', originalTitle: 'Dune', mediaType: 'book',
      overview: 'By Frank Herbert', releaseDate: '1965', rating: 8.6, voteCount: 444,
      posterUrl: 'https://covers.openlibrary.org/b/id/11481354-L.jpg?default=false',
      externalUrl: 'https://openlibrary.org/works/OL893414W',
    });
  });

  it('preserves special characters in the title parameter without adding URL parameters', async () => {
    const fetcher = mockFetch();
    const query = 'Dune & friends? q=*&page=500';
    await createOpenLibraryProvider({}, fetcher, 0).search({ ...request, query });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('title')).toBe(query);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('supports documented legacy count and work-ID shapes, absent metadata, and the page cap', async () => {
    const result = await createOpenLibraryProvider({}, mockFetch({ num_found: 10001, start: 0, docs: [{ key: 'OL893414W', title: 'Dune' }] }), 0).search(request);
    expect(result.totalPages).toBe(500);
    expect(result.results[0]).toMatchObject({ sourceId: 'OL893414W', overview: '', releaseDate: null, posterUrl: null, rating: null, voteCount: 0 });
    const noRatings = await createOpenLibraryProvider({}, mockFetch(payload([{ ...book, ratings_average: 0, ratings_count: 0, cover_i: -1 }])), 0).search(request);
    expect(noRatings.results[0]).toMatchObject({ rating: null, voteCount: 0, posterUrl: null });
    expect(await createOpenLibraryProvider({}, mockFetch(payload([], 0)), 0).search(request))
      .toMatchObject({ totalResults: 0, totalPages: 0, results: [] });
  });

  it.each(['/works/OL15093962M', '/books/OL15093962M', 'OL15093962M'])('keeps edition records returned in work searches: %s', async (key) => {
    // Live "The Bible" search includes /works/OL15093962M, which Open Library
    // redirects to /books/OL15093962M. One legacy edition must not reject the page.
    const edition = { key, title: 'The Holy Bible', first_publish_year: 1805, ratings_average: 4.1666665, ratings_count: 6 };
    const app = createApp(createProviderRegistry([createOpenLibraryProvider({}, mockFetch(payload([book, edition], 2)), 0)]));
    const response = await supertest(app).get('/api/search').query({ ...request, query: 'The Bible' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ totalResults: 2, totalPages: 1, page: 1 });
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0].externalUrl).toBe('https://openlibrary.org/works/OL893414W');
    expect(response.body.results[1]).toMatchObject({
      sourceId: 'OL15093962M', mediaType: 'book', title: 'The Holy Bible',
      releaseDate: '1805', voteCount: 6, externalUrl: 'https://openlibrary.org/books/OL15093962M',
    });
  });

  it('sends a supplied contact email only in the server User-Agent header', async () => {
    const fetcher = mockFetch();
    const app = createApp(createProviderRegistry([createOpenLibraryProvider({ contactEmail: ' developer@example.com ' }, fetcher, 0)]));
    const metadata = await supertest(app).get('/api/search/providers');
    expect(metadata.body.providers[0]).toMatchObject({ id: 'openlibrary', configured: true, requiresCredentials: false });
    const result = await supertest(app).get('/api/search').query(request);
    expect(result.status).toBe(200);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json', 'User-Agent': 'Libra/0.1.0 (developer@example.com)' });
    expect(metadata.text + result.text + String(fetcher.mock.calls[0][0])).not.toContain('developer@example.com');
  });

  it.each([[403, 'PROVIDER_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_ERROR'], [504, 'PROVIDER_TIMEOUT']])('handles upstream HTTP %s without exposing its body', async (status, code) => {
    const fetcher = mockFetch({ message: 'private upstream details' }, status as number);
    const app = createApp(createProviderRegistry([createOpenLibraryProvider({}, fetcher, 0)]));
    const response = await supertest(app).get('/api/search').query(request);
    expect(response.body.error.code).toBe(code);
    expect(response.text).not.toContain('private upstream details');
  });

  it.each([
    null, {}, { start: 0, docs: [] }, { numFound: -1, start: 0, docs: [] },
    payload([{ ...book, key: 'https://untrusted.example/book' }]), payload([{ ...book, key: '/authors/OL123A' }]),
    payload([{ ...book, key: '/works/OL123M/extra' }]),
    payload([{ ...book, title: ' ' }]), payload([{ ...book, ratings_average: 6 }]),
  ])('rejects malformed provider responses: %j', async (body) => {
    await expect(createOpenLibraryProvider({}, mockFetch(body), 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('handles network failures, invalid JSON, and body timeouts with safe messages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('developer@example.com'));
    await expect(createOpenLibraryProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.not.stringContaining('developer@example.com') });
    fetcher.mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
    await expect(createOpenLibraryProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    fetcher.mockResolvedValue(new Response('not JSON'));
    await expect(createOpenLibraryProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new DOMException('Aborted', 'AbortError'); } } as unknown as Response);
    await expect(createOpenLibraryProvider({}, fetcher, 0).search(request)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('coalesces duplicates, caches for five minutes, and keeps pages and years distinct', async () => {
    vi.useFakeTimers();
    const fetcher = mockFetch();
    const provider = createOpenLibraryProvider({}, fetcher, 0);
    const [first, second] = await Promise.all([provider.search(request), provider.search(request)]);
    expect(first).toBe(second);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.search({ ...request, page: 2 });
    await provider.search({ ...request, year: 1965 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() + 300_001);
    await provider.search(request);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([['', 1020], ['developer@example.com', 330]])('paces the shared request queue for contact %s', async (contactEmail, minimumMs) => {
    const starts: number[] = [];
    const fetcher = mockFetch();
    fetcher.mockImplementation(async () => { starts.push(Date.now()); return Response.json(payload()); });
    const provider = createOpenLibraryProvider({ contactEmail: String(contactEmail) }, fetcher);
    await Promise.all([provider.search(request), provider.search({ ...request, page: 2 })]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(Number(minimumMs));
  });

  it.each(['seconds', 'date', 'missing'])('honors Retry-After (%s) without leaving queued searches hanging', async (format) => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 8, 21);
    vi.setSystemTime(now);
    const waitMs = format === 'missing' ? 2000 : 60_000;
    const headers: Record<string, string> = format === 'missing' ? {} : { 'Retry-After': format === 'seconds' ? '60' : new Date(now + waitMs).toUTCString() };
    const fetcher = mockFetch();
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 429, headers }));
    const provider = createOpenLibraryProvider({}, fetcher, 0);
    const results = await Promise.allSettled([provider.search(request), provider.search({ ...request, page: 2 })]);
    for (const result of results) expect(result).toMatchObject({ status: 'rejected', reason: { code: 'PROVIDER_RATE_LIMITED' } });
    vi.setSystemTime(now + waitMs - 1);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + waitMs);
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 21 });
  });

  it('recovers after a failed request without caching the error', async () => {
    const fetcher = mockFetch();
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 500 }));
    const provider = createOpenLibraryProvider({}, fetcher, 0);
    await expect(provider.search(request)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(provider.search(request)).resolves.toMatchObject({ totalResults: 21 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds pending searches while sharing duplicates', async () => {
    let release!: (response: Response) => void;
    const fetcher = mockFetch();
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const provider = createOpenLibraryProvider({}, fetcher, 0);
    const pending = Array.from({ length: 12 }, (_, index) => provider.search({ ...request, page: index + 1 }));
    const duplicate = provider.search(request);
    await expect(provider.search({ ...request, page: 13 })).rejects.toMatchObject({ code: 'PROVIDER_BUSY' });
    release(Response.json(payload()));
    await Promise.all([...pending, duplicate]);
    expect(fetcher).toHaveBeenCalledTimes(12);
  });

  it.each([{ mediaType: 'audiobook' }, { language: 'en-US' }, { includeAdult: 'true' }, { email: 'browser@example.com' }])('rejects unsupported API input: %j', async (overrides) => {
    const fetcher = mockFetch();
    const app = createApp(createProviderRegistry([createOpenLibraryProvider({}, fetcher, 0)]));
    const response = await supertest(app).get('/api/search').query({ ...request, ...overrides });
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
