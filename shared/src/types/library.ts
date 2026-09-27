import type { CatalogItem, MediaType } from './search.js';
import type { MediaDetails } from './manual-entry.js';

export const libraryStatuses = ['planned', 'in_progress', 'completed', 'on_hold', 'dropped'] as const;
export type LibraryStatus = typeof libraryStatuses[number];
export type LibrarySort = 'added_desc' | 'title_asc' | 'rating_desc';

export interface LibraryTag { id: string; name: string }

export interface LibraryIdentity {
  id: string;
  provider: string;
  sourceId: string;
  mediaType: MediaType;
  status: LibraryStatus;
  tagIds: string[];
}

export interface LibraryEntry {
  id: string;
  item: CatalogItem;
  providerName: string;
  status: LibraryStatus;
  addedAt: string;
  updatedAt: string;
  details?: MediaDetails;
  tags: LibraryTag[];
}

export interface LibraryQuery {
  query?: string;
  mediaType?: MediaType;
  status?: LibraryStatus;
  sort?: LibrarySort;
  page?: number;
  tagIds?: string[];
}

export interface LibraryResponse {
  entries: LibraryEntry[];
  page: number;
  totalPages: number;
  totalResults: number;
  summary: { total: number; byStatus: Partial<Record<LibraryStatus, number>> };
}

export interface SaveEntryResponse { entry: LibraryEntry; created: boolean }

export interface LibraryBackup {
  format: 'libra-library';
  version: 1;
  exportedAt: string;
  tags: LibraryTag[];
  entries: LibraryEntry[];
}
export type ImportMode = 'keep' | 'update';
export interface ImportSummary {
  totalEntries: number; totalTags: number; added: number; updated: number; kept: number; restored: number; tagsAdded: number;
}
export const backupMaxBytes = 25 * 1024 * 1024;
