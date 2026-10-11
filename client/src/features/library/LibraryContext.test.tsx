// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry, LibraryIdentity } from '@libra/shared/library';
import type { CatalogItem } from '@libra/shared/search';
import { EntryTags } from '../entries/EntryTags';
import { LibraryProvider, useLibrary } from './LibraryContext';
import { TagSaveNotice } from './TagSaveNotice';
import { deleteTag, getLibraryIndex, removeEntry, updateEntryStatus, updateEntryTags } from './library.api';
import { importLibrary } from '../settings/backup.api';
import { readPendingTags, writePendingTags } from './pending-tags';

vi.mock('./library.api', () => ({ getLibraryIndex: vi.fn(), updateEntryTags: vi.fn(), updateEntryStatus: vi.fn(), saveEntry: vi.fn(), removeEntry: vi.fn(), createManualEntry: vi.fn(), restoreEntry: vi.fn(), createTag: vi.fn(), renameTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('../settings/backup.api', () => ({ importLibrary: vi.fn() }));
const item: CatalogItem = { provider: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Dune', originalTitle: 'Dune', overview: '', releaseDate: null, posterUrl: null, rating: null, voteCount: 0, externalUrl: 'https://example.com' };
const tags = [{ id: 'a', name: 'Favorites' }, { id: 'b', name: 'Revisit' }];
const identity: LibraryIdentity = { id: 'entry', provider: item.provider, sourceId: item.sourceId, mediaType: item.mediaType, status: 'planned', tagIds: [] };
const entry: LibraryEntry = { id: 'entry', item, status: 'planned', providerName: 'TMDB', tags: [], addedAt: '', updatedAt: '' };
let library: ReturnType<typeof useLibrary>;
function Probe({ editor = true }: { editor?: boolean }) { library = useLibrary(); return <><TagSaveNotice />{editor && <EntryTags item={item} />}</>; }
function app(editor = true) { return <LibraryProvider><Probe editor={editor} /></LibraryProvider>; }
async function initialize() { await act(async () => {}); }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.mocked(getLibraryIndex).mockResolvedValue({ entries: [identity], tags });
  vi.mocked(updateEntryTags).mockImplementation(async (_id, tagIds) => ({ entry: { ...entry, tags: tags.filter((tag) => tagIds.includes(tag.id)) } }));
  vi.mocked(updateEntryStatus).mockResolvedValue({ entry: { ...entry, status: 'completed' } });
  vi.mocked(deleteTag).mockResolvedValue({ removed: true });
  vi.mocked(removeEntry).mockResolvedValue({ removed: true });
  vi.mocked(importLibrary).mockResolvedValue({ summary: { totalEntries: 0, totalTags: 0, added: 0, updated: 0, kept: 0, restored: 0, tagsAdded: 0 } });
});
afterEach(async () => { cleanup(); await Promise.resolve(); vi.useRealTimers(); vi.resetAllMocks(); });

describe('pending entry tags', () => {
  it('shows selections immediately and retains their save window when details close and reopen', async () => {
    const view = render(app()); await initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(screen.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true');
    expect(updateEntryTags).not.toHaveBeenCalled();
    await tick(2_000);
    view.rerender(app(false));
    await tick(2_000);
    view.rerender(app());
    fireEvent.click(screen.getByRole('button', { name: 'Revisit' }));
    await tick(1_000);
    expect(updateEntryTags).toHaveBeenCalledExactlyOnceWith('entry', ['a', 'b'], { keepalive: true });
  });

  it('does not let refreshes or a late status response overwrite optimistic choices', async () => {
    render(app()); await initialize();
    let finish!: (value: { entries: LibraryIdentity[]; tags: typeof tags }) => void;
    vi.mocked(getLibraryIndex).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const refreshing = library.refresh();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    await act(async () => { finish({ entries: [identity], tags }); await refreshing; });
    await act(async () => { await library.refresh(); await library.update('entry', 'completed'); });
    expect(library.find(item)?.tagIds).toEqual(['a']);
    expect(library.find(item)?.status).toBe('completed');
    await tick(5_000);
    expect(library.find(item)?.status).toBe('completed');
  });

  it('keeps failures visible after details close and retries the original choices', async () => {
    vi.mocked(updateEntryTags).mockRejectedValueOnce(new Error('Database offline.'));
    const view = render(app()); await initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    view.rerender(app(false));
    await tick(5_000);
    expect(screen.getByRole('alert').textContent).toContain('Database offline.');
    expect(library.find(item)?.tagIds).toEqual(['a']);
    fireEvent.click(screen.getByRole('button', { name: 'Retry tags' }));
    await initialize();
    expect(updateEntryTags).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('flushes small keepalive writes when the page hides', async () => {
    render(app()); await initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(updateEntryTags).toHaveBeenCalledExactlyOnceWith('entry', ['a'], { keepalive: true });
    await tick(5_000);
    expect(updateEntryTags).toHaveBeenCalledTimes(1);
  });

  it('recovers pending tag choices after a reload and clears recovery data after saving', async () => {
    writePendingTags([{ id: 'entry', tagIds: ['a', 'b'] }, { id: 'removed-entry', tagIds: ['a'] }]);
    render(app()); await initialize();
    expect(library.find(item)?.tagIds).toEqual(['a', 'b']);
    expect(screen.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true');
    expect(readPendingTags()).toEqual([{ id: 'entry', tagIds: ['a', 'b'] }]);
    await tick(5_000);
    expect(updateEntryTags).toHaveBeenCalledExactlyOnceWith('entry', ['a', 'b'], { keepalive: true });
    expect(readPendingTags()).toEqual([]);
  });

  it('flushes before tag deletion or entry removal to avoid older saves restoring references', async () => {
    render(app()); await initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    await act(async () => library.deleteTag('a'));
    expect(vi.mocked(updateEntryTags).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deleteTag).mock.invocationCallOrder[0]);
    expect(library.find(item)?.tagIds).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Revisit' }));
    await act(async () => library.remove('entry'));
    expect(vi.mocked(updateEntryTags).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(removeEntry).mock.invocationCallOrder[0]);
    expect(library.find(item)).toBeUndefined();
  });

  it('persists edits before importing a backup and blocks the import when persistence fails', async () => {
    render(app()); await initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    vi.mocked(updateEntryTags).mockRejectedValueOnce(new Error('Offline.'));
    await act(async () => {
      await expect(library.importBackup({}, 'keep')).rejects.toThrow('Offline.');
    });
    expect(importLibrary).not.toHaveBeenCalled();
    await act(async () => library.importBackup({}, 'keep'));
    expect(vi.mocked(updateEntryTags).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(importLibrary).mock.invocationCallOrder[0]);
  });

  it('reconciles pending choices with tags and entries removed in another tab', async () => {
    render(app()); await initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisit' }));
    vi.mocked(getLibraryIndex).mockResolvedValueOnce({ entries: [identity], tags: [tags[1]] });
    await act(async () => library.refresh());
    expect(library.find(item)?.tagIds).toEqual(['b']);
    await tick(5_000);
    expect(updateEntryTags).toHaveBeenLastCalledWith('entry', ['b'], { keepalive: true });
    fireEvent.click(screen.getByRole('button', { name: 'Revisit' }));
    vi.mocked(getLibraryIndex).mockResolvedValueOnce({ entries: [], tags: [tags[1]] });
    await act(async () => library.refresh());
    await tick(5_000);
    expect(updateEntryTags).toHaveBeenCalledTimes(1);
    expect(readPendingTags()).toEqual([]);
  });
});
