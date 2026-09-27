import type { CatalogItem } from '@libra/shared/search';
import type { ManualEntryInput } from '@libra/shared/manual-entry';
import type { LibraryEntry, LibraryIdentity, LibraryQuery, LibraryResponse, LibraryStatus, LibraryTag, SaveEntryResponse } from '@libra/shared/library';
import { getJson, sendJson } from '../../api/client';

export const getLibraryIndex = (signal?: AbortSignal) => getJson<{ entries: LibraryIdentity[]; tags: LibraryTag[] }>('/api/entries/index', signal);
export function getLibrary(query: LibraryQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && String(value) !== '') params.set(key, String(value));
  return getJson<LibraryResponse>('/api/entries?' + params, signal);
}
export const saveEntry = (item: CatalogItem, status: LibraryStatus) => sendJson<SaveEntryResponse>('/api/entries', 'POST', { item, status });
export const updateEntryStatus = (id: string, status: LibraryStatus) => sendJson<{ entry: LibraryEntry }>('/api/entries/' + encodeURIComponent(id), 'PATCH', { status });
export const removeEntry = (id: string) => sendJson<{ removed: boolean }>('/api/entries/' + encodeURIComponent(id), 'DELETE');
export const createManualEntry = (input: ManualEntryInput) => sendJson<SaveEntryResponse>('/api/entries/manual', 'POST', input);
export const restoreEntry = (id: string) => sendJson<{ entry: LibraryEntry }>('/api/entries/' + encodeURIComponent(id) + '/restore', 'POST', {});
export const createTag = (name: string) => sendJson<{ tag: LibraryTag; created: boolean }>('/api/entries/tags', 'POST', { name });
export const renameTag = (id: string, name: string) => sendJson<{ tag: LibraryTag }>('/api/entries/tags/' + encodeURIComponent(id), 'PATCH', { name });
export const deleteTag = (id: string) => sendJson<{ removed: boolean }>('/api/entries/tags/' + encodeURIComponent(id), 'DELETE');
export const updateEntryTags = (id: string, tagIds: string[]) => sendJson<{ entry: LibraryEntry }>('/api/entries/' + encodeURIComponent(id) + '/tags', 'PATCH', { tagIds });
