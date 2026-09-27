import { describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { createProviderRegistry } from './catalog-provider.js';
import { createTmdbProvider } from './tmdb.js';
import type { CatalogSearchRequest } from '@libra/shared/search';

const baseRequest: CatalogSearchRequest = { provider: 'tmdb', query: 'Dune', mediaType: 'movie', page: 1 };
const movie = {
  id: 438631, title: 'Dune', original_title: 'Dune', overview: 'A science-fiction story.',
  release_date: '2021-09-15', poster_path: '/dune.jpg', vote_average: 7.8, vote_count: 100,
};
function payload(results: unknown[] = [movie]) {
  return { page: 1, total_pages: 2, total_results: 21, results };
}
function mockFetch(body: unknown = payload(), status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
function api(fetcher = mockFetch(), credentials = { readAccessToken: 'private-read-token', apiKey: 'private-key' }) {
  return createApp(createProviderRegistry([createTmdbProvider(credentials, fetcher)]));
}

describe('TMDB adapter', () => {
  it('uses Bearer authentication, encodes input, maps year, and normalizes movie results', async () => {
    const fetcher = mockFetch();
    const provider = createTmdbProvider({ readAccessToken: 'private-read-token', apiKey: 'private-key' }, fetcher);
    const result = await provider.search({ ...baseRequest, query: 'Dune & friends', year: 2021, page: 2, language: 'sq-AL', includeAdult: true });
    const [url, init] = fetcher.mock.calls[0];
    const upstream = new URL(String(url));
    expect(upstream.origin).toBe('https://api.themoviedb.org');
    expect(upstream.pathname).toBe('/3/search/movie');
    expect(upstream.searchParams.get('query')).toBe('Dune & friends');
    expect(upstream.searchParams.get('primary_release_year')).toBe('2021');
    expect(upstream.searchParams.get('first_air_date_year')).toBeNull();
    expect(upstream.searchParams.get('page')).toBe('2');
    expect(upstream.searchParams.get('language')).toBe('sq-AL');
    expect(upstream.searchParams.get('include_adult')).toBe('true');
    expect(upstream.searchParams.has('api_key')).toBe(false);
    expect(init?.headers).toEqual({ accept: 'application/json', Authorization: 'Bearer private-read-token' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result.results[0]).toMatchObject({
      sourceId: '438631', mediaType: 'movie', title: 'Dune', releaseDate: '2021-09-15',
      posterUrl: 'https://image.tmdb.org/t/p/w500/dune.jpg',
      rating: 7.8, externalUrl: 'https://www.themoviedb.org/movie/438631',
    });
  });

  it('supports an API key when the read token is blank', async () => {
    const fetcher = mockFetch();
    await createTmdbProvider({ apiKey: 'private-key', readAccessToken: ' ' }, fetcher).search(baseRequest);
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(String(url)).searchParams.get('api_key')).toBe('private-key');
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('uses TV first-air-date filters and normalizes missing covers and unrated titles', async () => {
    const fetcher = mockFetch(payload([{ id: 1399, name: 'A series', original_name: 'Original', first_air_date: '', poster_path: null, vote_average: 0, vote_count: 0 }]));
    const result = await createTmdbProvider({ apiKey: 'key' }, fetcher).search({ ...baseRequest, mediaType: 'tv', year: 2011 });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/3/search/tv');
    expect(url.searchParams.get('first_air_date_year')).toBe('2011');
    expect(url.searchParams.has('primary_release_year')).toBe(false);
    expect(result.results[0]).toMatchObject({
      title: 'A series', originalTitle: 'Original', mediaType: 'tv',
      releaseDate: null, posterUrl: null, rating: null, overview: '',
    });
  });

  it('does not contact TMDB without credentials', async () => {
    const fetcher = mockFetch();
    await expect(createTmdbProvider({}, fetcher).search(baseRequest)).rejects.toMatchObject({ status: 503, code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[401, 'PROVIDER_AUTH_ERROR'], [403, 'PROVIDER_AUTH_ERROR'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_ERROR']])(
    'handles upstream status %s without exposing provider response content',
    async (status, code) => {
      const response = await supertest(api(mockFetch({ status_message: 'private-read-token private-key' }, status as number)))
        .get('/api/search').query(baseRequest);
      expect(response.body.error.code).toBe(code);
      expect(JSON.stringify(response.body)).not.toContain('private-read-token');
      expect(JSON.stringify(response.body)).not.toContain('private-key');
    },
  );

  it('sanitizes network exceptions and gives timeout errors a separate status', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('https://api.themoviedb.org?api_key=private-key'));
    const response = await supertest(api(fetcher)).get('/api/search').query(baseRequest);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('private-key');
    fetcher.mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
    await expect(createTmdbProvider({ apiKey: 'key' }, fetcher).search(baseRequest)).rejects.toMatchObject({ status: 504, code: 'PROVIDER_TIMEOUT' });
  });

  it.each([null, { results: [] }, payload([{ ...movie, poster_path: '//evil.example/image' }]), payload([{ id: 1 }])])(
    'rejects malformed upstream responses',
    async (body) => {
      await expect(createTmdbProvider({ apiKey: 'key' }, mockFetch(body)).search(baseRequest))
        .rejects.toMatchObject({ status: 502, code: 'INVALID_PROVIDER_RESPONSE' });
    },
  );

  it('limits accessible pages and preserves an empty search result', async () => {
    const fetcher = mockFetch({ page: 1, total_pages: 1000, total_results: 20_000, results: [] });
    const response = await createTmdbProvider({ apiKey: 'key' }, fetcher).search(baseRequest);
    expect(response.totalPages).toBe(500);
    expect(response.results).toEqual([]);
  });
});

describe('search API', () => {
  it('returns only public provider metadata', async () => {
    const response = await supertest(api()).get('/api/search/providers');
    expect(response.status).toBe(200);
    expect(response.body.providers[0]).toMatchObject({ id: 'tmdb', configured: true, mediaTypes: ['movie', 'tv'] });
    expect(JSON.stringify(response.body)).not.toContain('private-read-token');
    expect(JSON.stringify(response.body)).not.toContain('private-key');
  });

  it('reports missing configuration through the real route', async () => {
    const fetcher = mockFetch();
    const app = createApp(createProviderRegistry([createTmdbProvider({}, fetcher)]));
    const metadata = await supertest(app).get('/api/search/providers');
    expect(metadata.body.providers[0].configured).toBe(false);
    const response = await supertest(app).get('/api/search').query(baseRequest);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { query: ' ' }, { page: 0 }, { page: 501 }, { year: 99 }, { year: '2024oops' },
    { year: 2024.5 }, { includeAdult: 'yes' }, { language: 'bad' },
    { provider: 'unknown' }, { mediaType: 'book' }, { query: 'a'.repeat(201) },
    { query: ['one', 'two'] }, { api_key: 'should-not-accept-client-secrets' },
  ])('rejects invalid or unsupported search input before contacting TMDB: %j', async (overrides) => {
    const fetcher = mockFetch();
    const response = await supertest(api(fetcher)).get('/api/search').query({ ...baseRequest, ...overrides });
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes validated queries through the API and keeps credentials out of results', async () => {
    const fetcher = mockFetch();
    const response = await supertest(api(fetcher)).get('/api/search').query({ ...baseRequest, query: ' Dune ' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.query).toBe('Dune');
    expect(response.body.results[0].title).toBe('Dune');
    expect(JSON.stringify(response.body)).not.toContain('private');
  });

  it('registers a second provider and enforces its supported filters', async () => {
    const books = {
      info: { id: 'books', name: 'Book Catalog', description: 'Test provider', website: 'https://example.com', configured: true, mediaTypes: ['book' as const], filters: { year: false, language: false, includeAdult: false } },
      search: vi.fn().mockResolvedValue({ provider: 'books', query: 'Dune', mediaType: 'book', page: 1, totalPages: 0, totalResults: 0, results: [] }),
    };
    const app = createApp(createProviderRegistry([createTmdbProvider({}), books]));
    const metadata = await supertest(app).get('/api/search/providers');
    expect(metadata.body.providers.map((item: { id: string }) => item.id)).toEqual(['tmdb', 'books']);
    const response = await supertest(app).get('/api/search').query({ ...baseRequest, provider: 'books', mediaType: 'book' });
    expect(response.status).toBe(200);
    expect(books.search).toHaveBeenCalledWith({ ...baseRequest, provider: 'books', mediaType: 'book' });
    const invalid = await supertest(app).get('/api/search').query({ ...baseRequest, provider: 'books', mediaType: 'book', year: 2021 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('UNSUPPORTED_FILTER');
  });
});
