import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CatalogItem } from '@libra/shared/search';
import type { ManualEntryInput } from '@libra/shared/manual-entry';
import type { ImportMode, ImportSummary, LibraryEntry, LibraryIdentity, LibraryStatus, LibraryTag } from '@libra/shared/library';
import { importLibrary } from '../settings/backup.api';
import { createManualEntry, createTag, deleteTag, getLibraryIndex, removeEntry, renameTag, restoreEntry, saveEntry, updateEntryStatus, updateEntryTags } from './library.api';

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
  setTags(id: string, tagIds: string[]): Promise<void>;
  importBackup(backup: unknown, mode: ImportMode): Promise<ImportSummary>;
}

const LibraryContext = createContext<LibraryState | null>(null);
const sourceKey = (item: Pick<CatalogItem, 'provider' | 'mediaType' | 'sourceId'>) => [item.provider, item.mediaType, item.sourceId].join(':');
const identity = (entry: LibraryEntry): LibraryIdentity => ({ id: entry.id, provider: entry.item.provider, sourceId: entry.item.sourceId, mediaType: entry.item.mediaType, status: entry.status, tagIds: entry.tags.map((tag) => tag.id) });
const sortTags = (tags: LibraryTag[]) => tags.sort((a, b) => a.name.localeCompare(b.name));

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LibraryIdentity[]>([]);
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const readId = useRef(0);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const currentRead = ++readId.current;
    const currentGeneration = generation.current;
    try {
      const result = await getLibraryIndex();
      if (!alive.current || currentRead !== readId.current || currentGeneration !== generation.current) return;
      setEntries(result.entries); setTags(sortTags(result.tags)); setReady(true); setError(''); setRevision((value) => value + 1);
    } catch (cause) {
      if (alive.current && currentRead === readId.current) setError(cause instanceof Error ? cause.message : 'Could not load your library.');
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { alive.current = false; readId.current++; window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  function remember(entry: LibraryEntry, field?: 'status' | 'tagIds') {
    generation.current++;
    setEntries((current) => {
      const previous = current.find((saved) => saved.id === entry.id);
      const next = identity(entry);
      // Status and tags may save independently; each response changes only its own field.
      const updated = previous && field ? { ...previous, [field]: next[field] } : next;
      return [...current.filter((saved) => saved.id !== entry.id), updated];
    });
    setRevision((value) => value + 1);
  }
  const indexed = useMemo(() => new Map(entries.map((entry) => [sourceKey(entry), entry])), [entries]);
  const state: LibraryState = {
    ready, error, revision, refresh, tags, find: (item) => indexed.get(sourceKey(item)),
    async save(item, status) { const { entry } = await saveEntry(item, status); remember(entry); return entry; },
    async update(id, status) { const { entry } = await updateEntryStatus(id, status); remember(entry, 'status'); return entry; },
    async createManual(input) { const { entry } = await createManualEntry(input); remember(entry); return entry; },
    async restore(id) { const { entry } = await restoreEntry(id); remember(entry); return entry; },
    async setTags(id, tagIds) { const { entry } = await updateEntryTags(id, tagIds); remember(entry, 'tagIds'); },
    async importBackup(backup, mode) {
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
      await deleteTag(id); generation.current++;
      setTags((current) => current.filter((tag) => tag.id !== id));
      setEntries((current) => current.map((entry) => ({ ...entry, tagIds: entry.tagIds.filter((tagId) => tagId !== id) })));
      setRevision((value) => value + 1);
    },
    async remove(id) {
      await removeEntry(id); generation.current++;
      setEntries((current) => current.filter((entry) => entry.id !== id)); setRevision((value) => value + 1);
    },
  };
  return <LibraryContext.Provider value={state}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('LibraryProvider is required');
  return value;
}
