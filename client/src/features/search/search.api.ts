import type { CatalogProviderInfo, CatalogSearchRequest, CatalogSearchResponse } from '@libra/shared/search';
import { getJson } from '../../api/client';

export function getProviders(signal?: AbortSignal) {
  return getJson<{ providers: CatalogProviderInfo[] }>('/api/search/providers', signal);
}

export function searchCatalog(request: CatalogSearchRequest, signal?: AbortSignal) {
  const params = new URLSearchParams({
    provider: request.provider, query: request.query,
    mediaType: request.mediaType, page: String(request.page),
  });
  if (request.year !== undefined) params.set('year', String(request.year));
  if (request.language !== undefined) params.set('language', request.language);
  if (request.includeAdult !== undefined) params.set('includeAdult', String(request.includeAdult));
  return getJson<CatalogSearchResponse>('/api/search?' + params, signal);
}
