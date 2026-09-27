import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogSearchResponse } from '@libra/shared/search';
import type { CatalogProvider } from './catalog-provider.js';
import { HttpError } from '../middleware/errors.js';

interface OpenLibraryOptions {
  contactEmail?: string;
}

const pageSize = 20;
const fields = 'key,title,author_name,first_publish_year,cover_i,ratings_average,ratings_count';
const itemSchema = z.object({
  // Search can include legacy editions, even under /works/ (e.g. OL15093962M).
  // Preserve their IDs and use the suffix to link to the canonical catalog path.
  key: z.string().regex(/^(?:\/(?:works|books)\/)?OL\d+[WM]$/),
  title: z.string().trim().min(1),
  author_name: z.array(z.string()).nullish(),
  first_publish_year: z.number().int().nullish(),
  cover_i: z.number().int().nullish(),
  ratings_average: z.number().min(0).max(5).nullish(),
  ratings_count: z.number().int().nonnegative().nullish(),
});
const responseSchema = z.object({
  // Both spellings appear in the official docs; live responses currently include both.
  numFound: z.number().int().nonnegative().optional(),
  num_found: z.number().int().nonnegative().optional(),
  start: z.number().int().nonnegative(),
  docs: z.array(itemSchema).max(pageSize),
}).refine((data) => data.numFound !== undefined || data.num_found !== undefined);

function retryAfterMs(value: string | null): number {
  if (value?.trim()) {
    const milliseconds = Number(value) * 1000;
    if (Number.isFinite(milliseconds)) return milliseconds >= 0 ? milliseconds : 2000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 2000;
}

function connectionError(error: unknown): HttpError {
  const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
  return new HttpError(timeout ? 504 : 502, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
    timeout ? 'Open Library took too long to respond. Please try again.' : 'Unable to reach Open Library. Please try again shortly.');
}

export function createOpenLibraryProvider(
  options: OpenLibraryOptions = {},
  fetcher: typeof fetch = fetch,
  intervalMs = options.contactEmail?.trim() ? 350 : 1050,
): CatalogProvider {
  const contactEmail = options.contactEmail?.trim();
  const userAgent = 'Libra/0.1.0' + (contactEmail ? ' (' + contactEmail + ')' : '');
  // Below the documented 1/sec public or 3/sec identified allowance per process.
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  let pending = 0;
  const inflight = new Map<string, Promise<CatalogSearchResponse>>();
  const cache = new Map<string, { expires: number; result: CatalogSearchResponse }>();
  const rateLimitError = () => new HttpError(429, 'PROVIDER_RATE_LIMITED',
    'Open Library’s request limit was reached. Try again in ' + Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000)) + ' seconds.');

  return {
    info: {
      id: 'openlibrary', name: 'Open Library', description: 'Books from the Internet Archive’s open catalog',
      website: 'https://openlibrary.org', configured: true, requiresCredentials: false,
      mediaTypes: ['book'], filters: { year: true, language: false, includeAdult: false },
    },
    async search(request) {
      if (request.mediaType !== 'book') throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE', 'Open Library search supports books.');
      const url = new URL('https://openlibrary.org/search.json');
      url.searchParams.set('title', request.query);
      if (request.year !== undefined) url.searchParams.set('q', 'first_publish_year:' + request.year);
      url.searchParams.set('fields', fields);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('page', String(request.page));
      const key = url.href;
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.result;
      if (cached) cache.delete(key);
      const existing = inflight.get(key);
      if (existing) return existing;
      if (cooldownUntil > Date.now()) throw rateLimitError();
      if (pending >= 12) throw new HttpError(429, 'PROVIDER_BUSY', 'Open Library has several searches queued. Wait a moment and try again.');

      pending++;
      const task = tail.then(async (): Promise<CatalogSearchResponse> => {
        if (cooldownUntil > Date.now()) throw rateLimitError();
        const wait = nextStart - Date.now();
        if (wait > 0) await delay(wait);
        nextStart = Date.now() + intervalMs;
        let response: Response;
        try {
          response = await fetcher(url, {
            headers: { Accept: 'application/json', 'User-Agent': userAgent },
            signal: AbortSignal.timeout(10_000),
          });
        } catch (error) { throw connectionError(error); }
        if (response.status === 429) {
          cooldownUntil = Date.now() + retryAfterMs(response.headers.get('Retry-After'));
          throw rateLimitError();
        }
        if (response.status === 403) throw new HttpError(502, 'PROVIDER_ACCESS_DENIED', 'Open Library blocked this request. Try again later; for regular use, set OPENLIBRARY_CONTACT_EMAIL on the server to identify Libra.');
        if (response.status === 504) throw new HttpError(504, 'PROVIDER_TIMEOUT', 'Open Library took too long to respond. Please try again.');
        if (!response.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'Open Library could not complete this search. Please try again.');
        const parsed = responseSchema.safeParse(await response.json().catch((error: unknown) => {
          if (error instanceof SyntaxError) return null;
          throw connectionError(error);
        }));
        if (!parsed.success) throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'Open Library returned an unexpected response. Please try again.');

        const total = parsed.data.numFound ?? parsed.data.num_found!;
        const result: CatalogSearchResponse = {
          provider: 'openlibrary', query: request.query, mediaType: 'book',
          page: Math.floor(parsed.data.start / pageSize) + 1,
          totalResults: total, totalPages: Math.min(Math.ceil(total / pageSize), 500),
          results: parsed.data.docs.map((book) => {
            const sourceId = book.key.replace(/^\/(?:works|books)\//, '');
            const authors = book.author_name?.map((name) => name.trim()).filter(Boolean) ?? [];
            const year = book.first_publish_year;
            return {
              provider: 'openlibrary', sourceId, mediaType: 'book', title: book.title, originalTitle: book.title,
              // Search supplies authors, not a synopsis; avoid one extra request per card.
              overview: authors.length ? 'By ' + authors.join(', ') : '',
              // Preserve year-only precision instead of inventing a month/day.
              releaseDate: year && year > 0 && year <= 9999 ? String(year).padStart(4, '0') : null,
              posterUrl: book.cover_i && book.cover_i > 0 ? 'https://covers.openlibrary.org/b/id/' + book.cover_i + '-L.jpg?default=false' : null,
              rating: book.ratings_average && book.ratings_average > 0 ? book.ratings_average * 2 : null,
              voteCount: book.ratings_count ?? 0,
              externalUrl: 'https://openlibrary.org/' + (sourceId.endsWith('M') ? 'books/' : 'works/') + sourceId,
            };
          }),
        };
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + 300_000, result });
        return result;
      });
      inflight.set(key, task);
      tail = task.catch(() => undefined);
      try { return await task; }
      finally { inflight.delete(key); pending--; }
    },
  };
}
