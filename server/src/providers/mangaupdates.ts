import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogSearchResponse, MediaType } from '@libra/shared/search';
import type { CatalogProvider } from './catalog-provider.js';
import { HttpError } from '../middleware/errors.js';

// https://api.mangaupdates.com/openapi.yaml: SeriesSearchRequestV1 / SeriesSearchResponseV1.
// Public series search needs no account. The acceptable-use policy requires credit,
// reasonable request spacing and caching; the UI credits each result to its provider.
const nativeTypes = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' } as const;
const recordSchema = z.object({
  series_id: z.number().int().positive().max(999_999_999_999_999),
  title: z.string().trim().min(1).max(2000),
  type: z.string(),
  url: z.string().nullish(),
  description: z.string().max(50000).nullish(),
  year: z.string().nullish(),
  image: z.object({ url: z.object({ original: z.string().nullish(), thumb: z.string().nullish() }).nullish() }).nullish(),
  bayesian_rating: z.number().min(0).max(10).nullish(),
  rating_votes: z.number().int().nonnegative().max(2_147_483_647).nullish(),
});
const responseSchema = z.object({
  total_hits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  results: z.array(z.object({ record: recordSchema })),
});

function safeUrl(value: string | null | undefined, hostname: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

function stripMarkdownLinks(value: string): string {
  let plain = '';
  for (let index = 0; index < value.length;) {
    const image = value[index] === '!' && value[index + 1] === '[';
    const opening = image ? index + 1 : index;
    if (value[opening] === '[') {
      const labelEnd = value.indexOf(']', opening + 1);
      if (labelEnd !== -1 && value[labelEnd + 1] === '(') {
        let depth = 1;
        let end = labelEnd + 2;
        for (; end < value.length && depth > 0; end++) {
          if (value[end] === '\\') { end++; continue; }
          if (value[end] === '\n') break;
          if (value[end] === '(') depth++;
          if (value[end] === ')') depth--;
        }
        if (depth === 0) {
          plain += value.slice(opening + 1, labelEnd);
          index = end;
          continue;
        }
      }
    }
    plain += value[index++];
  }
  return plain;
}

function plainDescription(value: string | null | undefined): string {
  return stripMarkdownLinks(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

function connectionError(error: unknown): HttpError {
  const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
  return new HttpError(timeout ? 504 : 502, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
    timeout ? 'MangaUpdates took too long to respond. Please try again.' : 'Unable to reach MangaUpdates. Please try again shortly.');
}

function retryAfterMs(value: string | null): number {
  if (value?.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(2000, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(2000, date - Date.now());
  }
  return 2000;
}

export function createMangaUpdatesProvider(fetcher: typeof fetch = fetch, intervalMs = 1000): CatalogProvider {
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  let pending = 0;
  const inflight = new Map<string, Promise<CatalogSearchResponse>>();
  const cache = new Map<string, { expires: number; result: CatalogSearchResponse }>();
  const invalidResponse = () => new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'MangaUpdates returned an unexpected response. Please try again.');
  const rateLimitError = () => new HttpError(429, 'PROVIDER_RATE_LIMITED',
    'MangaUpdates’ request limit was reached. Try again in ' + Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000)) + ' seconds.');

  return {
    info: {
      id: 'mangaupdates', name: 'MangaUpdates', description: 'Manhwa, manhua, webtoons & manga',
      website: 'https://www.mangaupdates.com', configured: true, requiresCredentials: false,
      mediaTypes: ['manhwa', 'manhua', 'webtoon', 'manga'],
      filters: { year: true, language: false, includeAdult: true },
    },
    async search(request) {
      if (!(request.mediaType in nativeTypes) && request.mediaType !== 'webtoon') {
        throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE', 'MangaUpdates search supports manga, manhwa, manhua and webtoons.');
      }
      const body = {
        search: request.query, stype: 'title', page: request.page, perpage: 25, orderby: 'score',
        // Webtoon is a format/category; the API's type field represents origin.
        ...(request.mediaType === 'webtoon' ? { category: ['Webtoon/Webcomic'] } : { type: [nativeTypes[request.mediaType as keyof typeof nativeTypes]] }),
        ...(request.year ? { year: String(request.year) } : {}),
        ...(!request.includeAdult ? { exclude_genre: ['Adult', 'Hentai', 'Smut'] } : {}),
      };
      const key = JSON.stringify(body);
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.result;
      if (cached) cache.delete(key);
      const existing = inflight.get(key);
      if (existing) return existing;
      if (cooldownUntil > Date.now()) throw rateLimitError();
      if (pending >= 8) throw new HttpError(429, 'PROVIDER_BUSY', 'MangaUpdates has several searches queued. Wait a moment and try again.');
      pending++;
      const queuedAt = Date.now();
      const task = tail.then(async (): Promise<CatalogSearchResponse> => {
        if (cooldownUntil > Date.now()) throw rateLimitError();
        if (Date.now() - queuedAt > 10_000) throw new HttpError(429, 'PROVIDER_BUSY', 'MangaUpdates is busy. Wait a moment and try again.');
        const wait = nextStart - Date.now();
        if (wait > 0) await delay(wait);
        nextStart = Date.now() + intervalMs;
        let response: Response;
        try {
          response = await fetcher('https://api.mangaupdates.com/v1/series/search', {
            method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Libra/0.1.0' },
            body: key, signal: AbortSignal.timeout(10_000),
          });
        } catch (error) { throw connectionError(error); }
        if (response.status === 429) {
          cooldownUntil = Date.now() + retryAfterMs(response.headers.get('Retry-After'));
          throw rateLimitError();
        }
        if (response.status === 403) throw new HttpError(502, 'PROVIDER_ACCESS_DENIED', 'MangaUpdates blocked this request. Please try again later.');
        if (response.status === 504) throw new HttpError(504, 'PROVIDER_TIMEOUT', 'MangaUpdates took too long to respond. Please try again later.');
        if (!response.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'MangaUpdates could not complete this search. Please try again.');
        const parsed = responseSchema.safeParse(await response.json().catch((error: unknown) => {
          if (error instanceof SyntaxError) return null;
          throw connectionError(error);
        }));
        if (!parsed.success) throw invalidResponse();
        const result: CatalogSearchResponse = {
          provider: 'mangaupdates', query: request.query, mediaType: request.mediaType,
          page: parsed.data.page, totalPages: Math.min(500, Math.ceil(parsed.data.total_hits / parsed.data.per_page)),
          totalResults: parsed.data.total_hits,
          results: parsed.data.results.map(({ record }) => {
            const originType = Object.entries(nativeTypes).find(([, value]) => value === record.type)?.[0] as MediaType | undefined;
            if (request.mediaType !== 'webtoon' && originType !== request.mediaType) throw invalidResponse();
            const canonical = safeUrl(record.url, 'www.mangaupdates.com');
            const fallback = 'https://www.mangaupdates.com/series/' + record.series_id.toString(36);
            return {
              provider: 'mangaupdates', sourceId: String(record.series_id),
              // Keep a manhwa's identity the same across Manhwa and Webtoon searches.
              mediaType: originType ?? 'webtoon', title: record.title, originalTitle: record.title,
              overview: plainDescription(record.description), releaseDate: record.year?.match(/^[1-9]\d{3}$/)?.[0] ?? null,
              posterUrl: safeUrl(record.image?.url?.original, 'cdn.mangaupdates.com') ?? safeUrl(record.image?.url?.thumb, 'cdn.mangaupdates.com'),
              rating: record.rating_votes && record.bayesian_rating && record.bayesian_rating > 0 ? record.bayesian_rating : null,
              voteCount: record.rating_votes ?? 0,
              externalUrl: canonical && new URL(canonical).pathname.split('/')[2] === record.series_id.toString(36)
                && /^\/series\/[a-z0-9]+(?:\/[^?#]*)?$/.test(new URL(canonical).pathname) ? canonical : fallback,
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
