import { z } from 'zod';
import type { CatalogItem } from '@libra/shared/search';
import { HttpError } from '../middleware/errors.js';
import type { CatalogProvider } from './catalog-provider.js';

interface TmdbCredentials {
  readAccessToken?: string;
  apiKey?: string;
}

const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/).nullable().optional();
const itemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  overview: z.string().nullable().optional(),
  release_date: date,
  first_air_date: date,
  poster_path: z.string().regex(/^\/[a-zA-Z0-9._-]+$/).nullable().optional(),
  vote_average: z.number().min(0).max(10).optional(),
  vote_count: z.number().int().nonnegative().optional(),
});
const responseSchema = z.object({
  page: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
  total_results: z.number().int().nonnegative(),
  results: z.array(itemSchema),
});

export function createTmdbProvider(
  credentials: TmdbCredentials,
  fetcher: typeof fetch = fetch,
): CatalogProvider {
  const token = credentials.readAccessToken?.trim();
  const apiKey = credentials.apiKey?.trim();

  return {
    info: {
      id: 'tmdb',
      name: 'TMDB',
      description: 'The Movie Database',
      website: 'https://www.themoviedb.org',
      configured: Boolean(token || apiKey),
      setupHint: 'Add TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY to server/.env, then restart the server.',
      mediaTypes: ['movie', 'tv'],
      filters: { year: true, language: true, includeAdult: true },
    },
    async search(request) {
      if (!token && !apiKey) {
        throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'TMDB is not connected yet. Add your credentials to server/.env and restart the server.');
      }
      if (request.mediaType !== 'movie' && request.mediaType !== 'tv') {
        throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE', 'TMDB search supports movies and TV series.');
      }

      const url = new URL('https://api.themoviedb.org/3/search/' + request.mediaType);
      url.searchParams.set('query', request.query);
      url.searchParams.set('page', String(request.page));
      url.searchParams.set('language', request.language ?? 'en-US');
      url.searchParams.set('include_adult', String(request.includeAdult ?? false));
      if (request.year !== undefined) {
        url.searchParams.set(request.mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(request.year));
      }
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      else url.searchParams.set('api_key', apiKey!);

      let response: Response;
      try {
        response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000) });
      } catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new HttpError(504, 'PROVIDER_TIMEOUT', 'TMDB took too long to respond. Please try again.');
        }
        throw new HttpError(502, 'PROVIDER_UNAVAILABLE', 'Unable to reach TMDB. Please try again shortly.');
      }

      if (response.status === 401 || response.status === 403) {
        throw new HttpError(502, 'PROVIDER_AUTH_ERROR', 'TMDB rejected the credentials. Check your API Read Access Token or API key in server/.env.');
      }
      if (response.status === 429) {
        throw new HttpError(429, 'PROVIDER_RATE_LIMITED', 'TMDB is receiving too many requests. Wait a moment and try again.');
      }
      if (!response.ok) {
        throw new HttpError(502, 'PROVIDER_ERROR', 'TMDB could not complete this search. Please try again.');
      }

      const body: unknown = await response.json().catch(() => null);
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'TMDB returned an unexpected response. Please try again.');
      }

      const results: CatalogItem[] = parsed.data.results.map((item) => {
        const title = request.mediaType === 'movie' ? item.title : item.name;
        if (!title?.trim()) {
          throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'TMDB returned an unexpected response. Please try again.');
        }
        return {
          provider: 'tmdb',
          sourceId: String(item.id),
          mediaType: request.mediaType,
          title,
          originalTitle: (request.mediaType === 'movie' ? item.original_title : item.original_name) || title,
          overview: item.overview || '',
          releaseDate: (request.mediaType === 'movie' ? item.release_date : item.first_air_date) || null,
          posterUrl: item.poster_path ? 'https://image.tmdb.org/t/p/w500' + item.poster_path : null,
          rating: (item.vote_count ?? 0) > 0 ? item.vote_average ?? null : null,
          voteCount: item.vote_count ?? 0,
          externalUrl: 'https://www.themoviedb.org/' + request.mediaType + '/' + item.id,
        };
      });

      return {
        provider: 'tmdb',
        query: request.query,
        mediaType: request.mediaType,
        page: parsed.data.page,
        totalPages: Math.min(parsed.data.total_pages, 500),
        totalResults: parsed.data.total_results,
        results,
      };
    },
  };
}
