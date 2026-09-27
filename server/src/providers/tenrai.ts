import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogSearchResponse } from '@libra/shared/search';
import type { CatalogProvider } from './catalog-provider.js';
import { HttpError } from '../middleware/errors.js';

interface TenraiCredentials {
  serverKey?: string;
}

const imageSchema = z.object({
  image_url: z.string().nullish(),
  large_image_url: z.string().nullish(),
});
const itemSchema = z.object({
  mal_id: z.number().int().positive(),
  title: z.string().nullish(),
  title_english: z.string().nullish(),
  title_japanese: z.string().nullish(),
  titles: z.array(z.object({ type: z.string(), title: z.string() })).optional(),
  synopsis: z.string().nullish(),
  images: z.object({ jpg: imageSchema.optional(), webp: imageSchema.optional() }).optional(),
  aired: z.object({ from: z.string().nullish() }).optional(),
  published: z.object({ from: z.string().nullish() }).optional(),
  score: z.number().min(0).max(10).nullish(),
  scored_by: z.number().int().nonnegative().nullish(),
});
const responseSchema = z.object({
  pagination: z.object({
    last_visible_page: z.number().int().nonnegative(),
    current_page: z.number().int().positive(),
    has_next_page: z.boolean(),
    items: z.object({ total: z.number().int().nonnegative() }),
  }),
  data: z.array(itemSchema),
});

function safePoster(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.myanimelist.net' ? url.href : null;
  } catch { return null; }
}

function retryAfterMs(value: string | null): number {
  if (value?.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 2000;
}

function connectionError(error: unknown): HttpError {
  const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
  return new HttpError(timeout ? 504 : 502, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
    timeout ? 'Tenrai took too long to respond. Please try again.' : 'Unable to reach Tenrai. Please try again shortly.');
}

export function createTenraiProvider(
  credentials: TenraiCredentials = {},
  fetcher: typeof fetch = fetch,
  intervalMs = credentials.serverKey?.trim() ? 210 : 550,
): CatalogProvider {
  const serverKey = credentials.serverKey?.trim();
  // One shared queue per adapter instance, below each tier's per-second/minute limits.
  // Cache repeated searches and coalesce identical concurrent requests.
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  let pending = 0;
  const inflight = new Map<string, Promise<CatalogSearchResponse>>();
  const cache = new Map<string, { expires: number; result: CatalogSearchResponse }>();
  const rateLimitError = () => new HttpError(429, 'PROVIDER_RATE_LIMITED',
    'Tenrai’s request limit was reached. Try again in ' + Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000)) + ' seconds.');

  return {
    info: {
      id: 'tenrai', name: 'Tenrai', description: 'Anime & manga from MyAnimeList',
      website: 'https://tenrai.org', configured: true, requiresCredentials: false,
      mediaTypes: ['anime', 'manga'],
      // Tenrai's start/end-date filters are not equivalent to a release-year filter.
      filters: { year: false, language: false, includeAdult: true },
    },
    async search(request) {
      if (request.mediaType !== 'anime' && request.mediaType !== 'manga') {
        throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE', 'Tenrai search supports anime and manga.');
      }
      const url = new URL('https://api.tenrai.org/v1/' + request.mediaType);
      url.searchParams.set('q', request.query);
      url.searchParams.set('page', String(request.page));
      url.searchParams.set('limit', '20');
      // Tenrai documents SFW as a presence flag: omit it when adult content is included.
      if (!request.includeAdult) url.searchParams.set('sfw', '');
      // /manga also contains novels, manhwa, etc.; this selector specifically asks for manga.
      if (request.mediaType === 'manga') url.searchParams.set('type', 'manga');
      const key = url.href;
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.result;
      if (cached) cache.delete(key);
      const existing = inflight.get(key);
      if (existing) return existing;
      if (cooldownUntil > Date.now()) throw rateLimitError();
      if (pending >= 12) throw new HttpError(429, 'PROVIDER_BUSY', 'Tenrai has several searches queued. Wait a moment and try again.');

      pending++;
      const task = tail.then(async (): Promise<CatalogSearchResponse> => {
        // Reject queued work during long daily/minute cooldowns instead of leaving it hanging.
        if (cooldownUntil > Date.now()) throw rateLimitError();
        const wait = nextStart - Date.now();
        if (wait > 0) await delay(wait);
        nextStart = Date.now() + intervalMs;
        let response: Response;
        try {
          response = await fetcher(url, {
            headers: { accept: 'application/json', ...(serverKey ? { 'X-Server-Key': serverKey } : {}) },
            signal: AbortSignal.timeout(10_000),
          });
        } catch (error) {
          throw connectionError(error);
        }
        if (response.status === 401) throw new HttpError(502, 'PROVIDER_AUTH_ERROR', 'Tenrai rejected the server key. Check TENRAI_SERVER_KEY in server/.env, or leave it blank for public access, then restart the server.');
        if (response.status === 403) throw new HttpError(502, 'PROVIDER_ACCESS_DENIED', 'Tenrai blocked this request. Try again later or contact Tenrai support if it persists.');
        if (response.status === 429) {
          cooldownUntil = Date.now() + retryAfterMs(response.headers.get('Retry-After'));
          throw rateLimitError();
        }
        if (response.status === 504) throw new HttpError(504, 'PROVIDER_TIMEOUT', 'Tenrai took too long to respond. Please try again later.');
        if (!response.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'Tenrai could not complete this search. Please try again.');
        const parsed = responseSchema.safeParse(await response.json().catch((error: unknown) => {
          if (error instanceof SyntaxError) return null;
          throw connectionError(error);
        }));
        if (!parsed.success) throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'Tenrai returned an unexpected response. Please try again.');

        const result: CatalogSearchResponse = {
          provider: 'tenrai', query: request.query, mediaType: request.mediaType,
          page: parsed.data.pagination.current_page,
          totalPages: Math.min(parsed.data.pagination.last_visible_page, 500),
          totalResults: parsed.data.pagination.items.total,
          results: parsed.data.data.map((item) => {
            const titleByType = (type: string) => item.titles?.find((title) => title.type === type)?.title;
            const title = titleByType('English') || item.title_english || titleByType('Default') || item.title;
            if (!title?.trim()) throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'Tenrai returned an unexpected response. Please try again.');
            const date = (request.mediaType === 'anime' ? item.aired : item.published)?.from;
            return {
              provider: 'tenrai', sourceId: String(item.mal_id), mediaType: request.mediaType,
              title, originalTitle: titleByType('Japanese') || item.title_japanese || titleByType('Default') || item.title || title,
              overview: item.synopsis || '',
              releaseDate: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
              posterUrl: safePoster(item.images?.jpg?.large_image_url) || safePoster(item.images?.jpg?.image_url) || safePoster(item.images?.webp?.image_url),
              rating: item.score && item.score > 0 ? item.score : null,
              voteCount: item.scored_by ?? 0,
              externalUrl: 'https://myanimelist.net/' + request.mediaType + '/' + item.mal_id,
            };
          }),
        };
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + 60_000, result });
        return result;
      });
      inflight.set(key, task);
      tail = task.catch(() => undefined);
      try { return await task; }
      finally { inflight.delete(key); pending--; }
    },
  };
}
