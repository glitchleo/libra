import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogSearchResponse } from '@libra/shared/search';
import type { CatalogProvider } from './catalog-provider.js';
import { HttpError } from '../middleware/errors.js';

interface IgdbCredentials {
  clientId?: string;
  accessToken?: string;
}

const pageSize = 20;
const gameSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  summary: z.string().nullish(),
  storyline: z.string().nullish(),
  first_release_date: z.number().int().min(-62135596800).max(253402300799).nullish(),
  cover: z.object({ image_id: z.string().nullish() }).nullish(),
  total_rating: z.number().min(0).max(100).nullish(),
  total_rating_count: z.number().int().nonnegative().nullish(),
});
const gamesSchema = z.array(gameSchema).max(pageSize);
const countSchema = z.object({ count: z.number().int().nonnegative() });

function connectionError(error: unknown): HttpError {
  const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
  return new HttpError(timeout ? 504 : 502, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
    timeout ? 'IGDB took too long to respond. Please try again.' : 'Unable to reach IGDB. Please try again shortly.');
}

export function createIgdbProvider(
  credentials: IgdbCredentials,
  fetcher: typeof fetch = fetch,
  intervalMs = 300,
): CatalogProvider {
  const clientId = credentials.clientId?.trim();
  const accessToken = credentials.accessToken?.trim();
  // Serialize complete requests: below IGDB's 4 requests/sec and 8 open requests.
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  let pending = 0;
  const inflight = new Map<string, Promise<CatalogSearchResponse>>();
  const cache = new Map<string, { expires: number; result: CatalogSearchResponse }>();

  return {
    info: {
      id: 'igdb', name: 'IGDB', description: 'Video games from the Internet Game Database',
      website: 'https://www.igdb.com', configured: Boolean(clientId && accessToken),
      requiresCredentials: true,
      setupHint: 'Add IGDB_CLIENT_ID and IGDB_ACCESS_TOKEN to server/.env, then restart the server.',
      mediaTypes: ['game'],
      // Age ratings are not an equivalent of TMDB/Tenrai's adult-content filters.
      filters: { year: true, language: false, includeAdult: false },
    },
    async search(request) {
      if (!clientId || !accessToken) {
        throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'IGDB is not connected yet. Add IGDB_CLIENT_ID and IGDB_ACCESS_TOKEN to server/.env and restart the server.');
      }
      if (request.mediaType !== 'game') {
        throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE', 'IGDB search supports games.');
      }

      // Quote user input as one APICalypse string; never interpolate raw query syntax.
      const search = 'search ' + JSON.stringify(request.query.replace(/[\u0000-\u001f\u007f]/g, ' ')) + ';';
      const yearFilter = request.year === undefined ? '' : ' where first_release_date >= ' +
        Date.UTC(request.year, 0, 1) / 1000 + ' & first_release_date < ' + Date.UTC(request.year + 1, 0, 1) / 1000 + ';';
      const criteria = search + yearFilter;
      // Use the direct endpoints: multiquery can return [] for a valid search.
      // Identical criteria keep the total and page aligned without changing relevance.
      const gamesQuery = criteria +
        ' fields name,slug,summary,storyline,first_release_date,cover.image_id,total_rating,total_rating_count;' +
        ' limit ' + pageSize + '; offset ' + (request.page - 1) * pageSize + ';';
      const key = JSON.stringify([request.query, request.page, request.year]);
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.result;
      if (cached) cache.delete(key);
      const existing = inflight.get(key);
      if (existing) return existing;
      if (pending >= 12) throw new HttpError(429, 'PROVIDER_BUSY', 'IGDB has several searches queued. Wait a moment and try again.');

      pending++;
      const task = tail.then(async (): Promise<CatalogSearchResponse> => {
        const post = async (endpoint: 'games' | 'games/count', body: string): Promise<unknown> => {
          // Pace each HTTP request, including the count call, across the shared queue.
          const wait = nextStart - Date.now();
          if (wait > 0) await delay(wait);
          nextStart = Date.now() + intervalMs;
          let response: Response;
          try {
            response = await fetcher('https://api.igdb.com/v4/' + endpoint, {
              method: 'POST',
              headers: {
                'Client-ID': clientId, Authorization: 'Bearer ' + accessToken,
                Accept: 'application/json', 'Content-Type': 'text/plain',
              },
              body, signal: AbortSignal.timeout(10_000),
            });
          } catch (error) {
            throw connectionError(error);
          }
          if (response.status === 401 || response.status === 403) {
            throw new HttpError(502, 'PROVIDER_AUTH_ERROR', 'IGDB rejected the credentials. Check IGDB_CLIENT_ID and IGDB_ACCESS_TOKEN in server/.env. If the app token expired, generate a new one with Twitch client credentials and restart the server.');
          }
          if (response.status === 429) {
            nextStart = Math.max(nextStart, Date.now() + 2000);
            throw new HttpError(429, 'PROVIDER_RATE_LIMITED', 'IGDB is receiving too many requests. Wait a moment and try again.');
          }
          if (response.status === 504) throw new HttpError(504, 'PROVIDER_TIMEOUT', 'IGDB took too long to respond. Please try again.');
          if (!response.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'IGDB could not complete this search. Please try again.');
          return response.json().catch((error: unknown) => {
            if (error instanceof SyntaxError) return null;
            throw connectionError(error);
          });
        };
        const games = gamesSchema.safeParse(await post('games', gamesQuery));
        if (!games.success) throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'IGDB returned unexpected game data. Please try again.');
        const total = countSchema.safeParse(await post('games/count', criteria));
        if (!total.success) throw new HttpError(502, 'INVALID_PROVIDER_RESPONSE', 'IGDB returned an unexpected result count. Please try again.');

        const result: CatalogSearchResponse = {
          provider: 'igdb', query: request.query, mediaType: 'game', page: request.page,
          totalPages: Math.min(Math.ceil(total.data.count / pageSize), 500), totalResults: total.data.count,
          results: games.data.map((game) => ({
            provider: 'igdb', sourceId: String(game.id), mediaType: 'game',
            title: game.name, originalTitle: game.name, overview: game.summary || game.storyline || '',
            releaseDate: game.first_release_date == null ? null : new Date(game.first_release_date * 1000).toISOString().slice(0, 10),
            posterUrl: game.cover?.image_id && /^[a-zA-Z0-9_-]+$/.test(game.cover.image_id)
              ? 'https://images.igdb.com/igdb/image/upload/t_cover_big/' + game.cover.image_id + '.jpg' : null,
            rating: game.total_rating == null ? null : game.total_rating / 10,
            voteCount: game.total_rating_count ?? 0,
            externalUrl: 'https://www.igdb.com/games/' + encodeURIComponent(game.slug),
          })),
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
