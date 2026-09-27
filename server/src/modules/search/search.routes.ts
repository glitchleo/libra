import { Router } from 'express';
import { HttpError } from '../../middleware/errors.js';
import type { ProviderRegistry } from '../../providers/catalog-provider.js';
import { searchQuerySchema } from './search.validation.js';

export function createSearchRouter(providers: ProviderRegistry) {
  const router = Router();
  router.get('/providers', (_req, res) => {
    res.json({ providers: [...providers.values()].map((provider) => provider.info) });
  });
  router.get('/', async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_SEARCH', 'Check your search: enter a title, a supported media type, a four-digit year if needed, and a valid page.');
    }
    const request = parsed.data;
    const provider = providers.get(request.provider);
    if (!provider) throw new HttpError(400, 'UNKNOWN_PROVIDER', 'Choose an available catalog provider.');
    if (!provider.info.mediaTypes.includes(request.mediaType)) {
      throw new HttpError(400, 'UNSUPPORTED_MEDIA_TYPE', 'This catalog does not support the selected media type.');
    }
    const filters = provider.info.filters;
    if ((request.year !== undefined && !filters.year) ||
        (request.language !== undefined && !filters.language) ||
        (request.includeAdult !== undefined && !filters.includeAdult)) {
      throw new HttpError(400, 'UNSUPPORTED_FILTER', 'This catalog does not support one of the selected filters.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(await provider.search(request));
  });
  return router;
}
