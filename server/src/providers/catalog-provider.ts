import type { CatalogProviderInfo, CatalogSearchRequest, CatalogSearchResponse } from '@libra/shared/search';

export interface CatalogProvider {
  info: CatalogProviderInfo;
  search(request: CatalogSearchRequest): Promise<CatalogSearchResponse>;
}

export type ProviderRegistry = ReadonlyMap<string, CatalogProvider>;

export function createProviderRegistry(providers: CatalogProvider[]): ProviderRegistry {
  const registry = new Map<string, CatalogProvider>();
  for (const provider of providers) {
    if (registry.has(provider.info.id)) throw new Error('Duplicate catalog provider ID');
    registry.set(provider.info.id, provider);
  }
  return registry;
}
