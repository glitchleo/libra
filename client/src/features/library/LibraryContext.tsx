import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CatalogItem } from '@libra/shared/search';
import type { ManualEntryInput } from '@libra/shared/manual-entry';
import type { ImportMode, ImportSummary, LibraryEntry, LibraryIdentity, LibraryStatus, LibraryTag } from '@libra/shared/library';
import { importLibrary } from '../settings/backup.api';
import { createManualEntry, createTag, deleteTag, getLibraryIndex, removeEntry, renameTag, restoreEntry, saveEntry, updateEntryStatus, updateEntryTags } from './library.api';
import { TagSaveQueue } from './tag-save-queue';
import type { TagSaveState } from './tag-save-queue';
import { readPendingTags, writePendingTags } from './pending-tags';

interface LibraryState {
  ready: boolean; error: string; revision: number;
  find(item: CatalogItem): LibraryIdentity | undefined;
  refresh(): Promise<void>;
  save(item: CatalogItem, status: LibraryStatus): Promise<LibraryEntry>;
  update(id: string, status: LibraryStatus): Promise<LibraryEntry>;
  remove(id: string): Promise<void>;
  createManual(input: ManualEntryInput): Promise<LibraryEntry>;
  restore(id: string): Promise<LibraryEntry>;
  tags: LibraryTag[];
  createTag(name: string): Promise<LibraryTag>;
  renameTag(id: string, name: string): Promise<void>;
  deleteTag(id: string): Promise<void>;
  setTags(id: string, tagIds: string[]): void;
  tagSaves: Record<string, TagSaveState>;
  retryTags(id: string): Promise<void>;
  flushTags(): Promise<void>;
  importBackup(backup: unknown, mode: ImportMode): Promise<ImportSummary>;
}

const LibraryContext = createContext<LibraryState | null>(null);
const sourceKey = (item: Pick<CatalogItem, 'provider' | 'mediaType' | 'sourceId'>) => [item.provider, item.mediaType, item.sourceId].join(':');
const identity = (entry: LibraryEntry): LibraryIdentity => ({ id: entry.id, provider: entry.item.provider, sourceId: entry.item.sourceId, mediaType: entry.item.mediaType, status: entry.status, tagIds: entry.tags.map((tag) => tag.id) });
const sortTags = (tags: LibraryTag[]) => tags.sort((a, b) => a.name.localeCompare(b.name));

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [, setEntries] = useState<LibraryIdentity[]>([]);
  const entries = useRef<LibraryIdentity[]>([]);
  const indexed = useRef(new Map<string, LibraryIdentity>());
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [tagSaves, setTagSaves] = useState<Record<string, TagSaveState>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const readId = useRef(0);
  const alive = useRef(true);
  const tagQueue = useRef<TagSaveQueue | null>(null);
  const [recoveredTags] = useState(readPendingTags);
  const recovered = useRef(recoveredTags);
  const changeEntries = useCallback((next: LibraryIdentity[] | ((current: LibraryIdentity[]) => LibraryIdentity[])) => {
    entries.current = typeof next === 'function' ? next(entries.current) : next;
    indexed.current = new Map(entries.current.map((entry) => [sourceKey(entry), entry]));
    setEntries(entries.current);
  }, []);
  const refresh = useCallback(async () => {
    const currentRead = ++readId.current;
    const currentGeneration = generation.current;
    try {
      const result = await getLibraryIndex();
      if (!alive.current || currentRead !== readId.current || currentGeneration !== generation.current) return;
      // A previous document may have closed with newer choices behind an in-flight save.
      for (const pending of recovered.current) {
        if (result.entries.some((entry) => entry.id === pending.id)) {
          tagQueue.current!.enqueue(pending.id, pending.tagIds.filter((id) => result.tags.some((tag) => tag.id === id)));
        }
      }
      recovered.current = [];
      // Reconcile changes made in another tab while keeping valid local selections.
      const availableTags = new Set(result.tags.map((tag) => tag.id));
      const availableEntries = new Set(result.entries.map((entry) => entry.id));
      for (const pending of tagQueue.current!.pending()) {
        if (!availableEntries.has(pending.id)) tagQueue.current!.discard(pending.id);
        else {
          const selected = pending.tagIds.filter((id) => availableTags.has(id));
          if (selected.length !== pending.tagIds.length) tagQueue.current!.enqueue(pending.id, selected);
        }
      }
      writePendingTags(tagQueue.current!.pending());
      // A focus/refresh request must not replace choices still waiting to save.
      changeEntries(result.entries.map((entry) => ({ ...entry, tagIds: tagQueue.current?.desired(entry.id) ?? entry.tagIds })));
      setTags(sortTags(result.tags)); setReady(true); setError(''); setRevision((value) => value + 1);
    } catch (cause) {
      if (alive.current && currentRead === readId.current) setError(cause instanceof Error ? cause.message : 'Could not load your library.');
    }
  }, [changeEntries]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    const flush = () => { void tagQueue.current?.flushAll().catch(() => {}); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      tagQueue.current?.clearTimers();
      alive.current = false; readId.current++;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  function remember(entry: LibraryEntry, field?: 'status' | 'tagIds') {
    if (!alive.current) return;
    generation.current++;
    changeEntries((current) => {
      const previous = current.find((saved) => saved.id === entry.id);
      const next = identity(entry);
      // Status and tags may save independently; each response changes only its own field.
      const updated = previous && field ? { ...previous, [field]: next[field] } : next;
      updated.tagIds = tagQueue.current?.desired(entry.id) ?? updated.tagIds;
      return [...current.filter((saved) => saved.id !== entry.id), updated];
    });
    setRevision((value) => value + 1);
  }
  if (!tagQueue.current) tagQueue.current = new TagSaveQueue(
    // Keep small tag writes alive when the page closes or refreshes.
    (id, tagIds) => updateEntryTags(id, tagIds, { keepalive: true }),
    (entry) => remember(entry, 'tagIds'),
    () => {
      writePendingTags(tagQueue.current!.pending());
      if (alive.current) setTagSaves(tagQueue.current!.states());
    },
  );
  const state: LibraryState = {
    ready, error, revision, refresh, tags, tagSaves, find: (item) => indexed.current.get(sourceKey(item)),
    async save(item, status) { const { entry } = await saveEntry(item, status); remember(entry); return entry; },
    async update(id, status) { const { entry } = await updateEntryStatus(id, status); remember(entry, 'status'); return entry; },
    async createManual(input) { const { entry } = await createManualEntry(input); remember(entry); return entry; },
    async restore(id) { const { entry } = await restoreEntry(id); remember(entry); return entry; },
    setTags(id, tagIds) {
      const next = [...new Set(tagIds)];
      if (next.length > 50) throw new Error('An entry can have up to 50 tags.');
      generation.current++;
      changeEntries((current) => current.map((entry) => entry.id === id ? { ...entry, tagIds: next } : entry));
      tagQueue.current!.enqueue(id, next);
    },
    retryTags: (id) => tagQueue.current!.flush(id),
    flushTags: () => tagQueue.current!.flushAll(),
    async importBackup(backup, mode) {
      await tagQueue.current!.flushAll();
      const { summary } = await importLibrary(backup, mode); generation.current++; setRevision((value) => value + 1);
      await refresh(); return summary;
    },
    async createTag(name) {
      const { tag } = await createTag(name); generation.current++;
      setTags((current) => sortTags([...current.filter((value) => value.id !== tag.id), tag]));
      setRevision((value) => value + 1); return tag;
    },
    async renameTag(id, name) {
      const { tag } = await renameTag(id, name); generation.current++;
      setTags((current) => sortTags(current.map((value) => value.id === id ? tag : value)));
      setRevision((value) => value + 1);
    },
    async deleteTag(id) {
      // Delete after queued assignments finish, so an older write cannot restore the tag.
      await tagQueue.current!.flushAll();
      await deleteTag(id); generation.current++;
      tagQueue.current!.removeTag(id);
      setTags((current) => current.filter((tag) => tag.id !== id));
      changeEntries((current) => current.map((entry) => ({ ...entry, tagIds: entry.tagIds.filter((tagId) => tagId !== id) })));
      setRevision((value) => value + 1);
    },
    async remove(id) {
      await tagQueue.current!.flush(id);
      await removeEntry(id); generation.current++;
      // Any choices made while removal was in flight belong to the removed entry.
      tagQueue.current!.discard(id);
      changeEntries((current) => current.filter((entry) => entry.id !== id)); setRevision((value) => value + 1);
    },
  };
  return <LibraryContext.Provider value={state}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('LibraryProvider is required');
  return value;
}
