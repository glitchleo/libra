export type MediaType = 'movie' | 'tv' | 'anime' | 'book' | 'manga' | 'manhwa' | 'game' | 'audiobook' | 'other';

export interface CatalogProviderInfo {
  id: string;
  name: string;
  description: string;
  website: string;
  configured: boolean;
  requiresCredentials?: boolean;
  setupHint?: string;
  mediaTypes: MediaType[];
  filters: { year: boolean; language: boolean; includeAdult: boolean };
}

export interface CatalogSearchRequest {
  provider: string;
  query: string;
  mediaType: MediaType;
  page: number;
  year?: number;
  language?: string;
  includeAdult?: boolean;
}

export interface CatalogItem {
  provider: string;
  sourceId: string;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  overview: string;
  // ISO date, or a four-digit year when the catalog only knows publication year.
  releaseDate: string | null;
  posterUrl: string | null;
  rating: number | null;
  voteCount: number;
  externalUrl: string;
}

export interface CatalogSearchResponse {
  provider: string;
  query: string;
  mediaType: MediaType;
  page: number;
  totalPages: number;
  totalResults: number;
  results: CatalogItem[];
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
