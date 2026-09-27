// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogItem, CatalogProviderInfo } from '@libra/shared/search';
import type { LibraryEntry, LibraryResponse, LibraryStatus, LibraryTag } from '@libra/shared/library';
import { App } from '../../app/App';
import { getProviders, searchCatalog } from '../search/search.api';
import { createTag, deleteTag, getLibrary, getLibraryIndex, removeEntry, renameTag, saveEntry, updateEntryStatus, updateEntryTags } from './library.api';

vi.mock('../search/search.api', () => ({ getProviders: vi.fn(), searchCatalog: vi.fn() }));
vi.mock('./library.api', () => ({ getLibrary: vi.fn(), getLibraryIndex: vi.fn(), saveEntry: vi.fn(), updateEntryStatus: vi.fn(), removeEntry: vi.fn(), createTag: vi.fn(), renameTag: vi.fn(), deleteTag: vi.fn(), updateEntryTags: vi.fn() }));

const movie: CatalogItem = { provider: 'tmdb', sourceId: '438631', mediaType: 'movie', title: 'Dune', originalTitle: 'Dune', overview: 'A science-fiction story.', releaseDate: '2021-09-15', posterUrl: null, rating: 7.8, voteCount: 100, externalUrl: 'https://www.themoviedb.org/movie/438631' };
const providers: CatalogProviderInfo[] = [
  { id: 'tmdb', name: 'TMDB', description: 'Movies and TV', website: 'https://www.themoviedb.org', configured: true, mediaTypes: ['movie', 'tv'], filters: { year: true, language: true, includeAdult: true } },
  { id: 'igdb', name: 'IGDB', description: 'Games', website: 'https://www.igdb.com', configured: true, mediaTypes: ['game'], filters: { year: true, language: false, includeAdult: false } },
  { id: 'openlibrary', name: 'Open Library', description: 'Books', website: 'https://openlibrary.org', configured: true, mediaTypes: ['book'], filters: { year: true, language: false, includeAdult: false } },
];
const makeEntry = (item = movie, status: LibraryStatus = 'planned'): LibraryEntry => ({
  id: 'c1736ed7-7d30-452c-94ef-34a3771d4949', item, providerName: providers.find((provider) => provider.id === item.provider)!.name,
  status, tags: [], addedAt: '2026-09-22T12:00:00Z', updatedAt: '2026-09-22T12:00:00Z',
});
let saved: LibraryEntry[] = [];
let tags: LibraryTag[] = [];
const favorites = { id: '77d86a44-77c5-4c25-a0b1-29031f580001', name: 'Favorites' };
const revisit = { id: '77d86a44-77c5-4c25-a0b1-29031f580002', name: 'Revisit' };
function response(): LibraryResponse {
  const byStatus: Partial<Record<LibraryStatus, number>> = {};
  saved.forEach((entry) => { byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1; });
  return { entries: [...saved], totalResults: saved.length, page: 1, totalPages: 1, summary: { total: saved.length, byStatus } };
}
function renderApp(path = '/search') { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
async function openMovie(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect((screen.getByLabelText('Data provider') as HTMLSelectElement).value).toBe('tmdb'));
  await user.click(screen.getByRole('button', { name: 'Dune' }));
  await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
  await screen.findByRole('button', { name: 'Add to library' });
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector('button')?.focus(); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => {
  localStorage.clear();
  saved = [];
  tags = [];
  vi.mocked(getProviders).mockResolvedValue({ providers });
  vi.mocked(searchCatalog).mockImplementation(async (request) => ({ ...request, page: 1, totalPages: 1, totalResults: 1, results: [{ ...movie, provider: request.provider, mediaType: request.mediaType }] }));
  vi.mocked(getLibraryIndex).mockImplementation(async () => ({ tags: [...tags], entries: saved.map((entry) => ({ id: entry.id, provider: entry.item.provider, sourceId: entry.item.sourceId, mediaType: entry.item.mediaType, status: entry.status, tagIds: entry.tags.map((tag) => tag.id) })) }));
  vi.mocked(getLibrary).mockImplementation(async () => response());
  vi.mocked(saveEntry).mockImplementation(async (item, status) => { const entry = makeEntry(item, status); saved = [entry]; return { entry, created: true }; });
  vi.mocked(updateEntryStatus).mockImplementation(async (_id, status) => { saved = saved.map((entry) => ({ ...entry, status })); return { entry: saved[0] }; });
  vi.mocked(removeEntry).mockImplementation(async () => { saved = []; return { removed: true }; });
  vi.mocked(createTag).mockImplementation(async (name) => {
    const tag = { id: '77d86a44-77c5-4c25-a0b1-29031f580009', name }; tags.push(tag); return { tag, created: true };
  });
  vi.mocked(updateEntryTags).mockImplementation(async (id, tagIds) => {
    saved = saved.map((entry) => entry.id === id ? { ...entry, tags: tags.filter((tag) => tagIds.includes(tag.id)) } : entry);
    return { entry: saved.find((entry) => entry.id === id)! };
  });
  vi.mocked(renameTag).mockImplementation(async (id, name) => {
    const tag = { id, name }; tags = tags.map((value) => value.id === id ? tag : value);
    saved = saved.map((entry) => ({ ...entry, tags: entry.tags.map((value) => value.id === id ? tag : value) }));
    return { tag };
  });
  vi.mocked(deleteTag).mockImplementation(async (id) => {
    tags = tags.filter((tag) => tag.id !== id); saved = saved.map((entry) => ({ ...entry, tags: entry.tags.filter((tag) => tag.id !== id) }));
    return { removed: true };
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('library workflows', () => {
  it('creates custom tags, assigns multiple tags, combines filters and restores assignments on remount', async () => {
    const user = userEvent.setup(); saved = [makeEntry()]; tags = [favorites, revisit];
    renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Manage tags' }));
    await user.type(screen.getByLabelText('New tag'), 'Cozy evenings');
    await user.click(screen.getByRole('button', { name: 'Create tag' }));
    await screen.findByText('Tag ready to use.');
    expect(createTag).toHaveBeenCalledWith('Cozy evenings');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    const assignments = within(screen.getByRole('group', { name: 'Assign tags' }));
    for (const name of ['Favorites', 'Revisit', 'Cozy evenings']) {
      await user.click(assignments.getByRole('button', { name }));
      await waitFor(() => expect(assignments.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true'));
    }
    expect(saved[0].tags).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Back to library' }));
    await waitFor(() => expect(within(screen.getByLabelText('Tags for Dune')).getByText('Cozy evenings')).toBeTruthy());
    const filters = within(screen.getByRole('group', { name: 'Filter by tags' }));
    await user.click(filters.getByRole('button', { name: 'Favorites' }));
    await user.click(filters.getByRole('button', { name: 'Revisit' }));
    await user.type(screen.getByLabelText('Search your library'), 'Dune');
    await waitFor(() => expect(getLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Dune', tagIds: [favorites.id, revisit.id], page: 1 }), expect.any(AbortSignal)));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(getLibrary).toHaveBeenLastCalledWith(expect.not.objectContaining({ tagIds: expect.anything() }), expect.any(AbortSignal)));
    cleanup(); renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    expect(within(screen.getByRole('group', { name: 'Assign tags' })).getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps assignments unchanged after a failed save, supports retry, and creates a tag inside entry details', async () => {
    const user = userEvent.setup(); saved = [{ ...makeEntry(), tags: [favorites] }]; tags = [favorites, revisit];
    vi.mocked(updateEntryTags).mockRejectedValueOnce(new Error('Tags could not be saved.'));
    renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    const assignments = within(screen.getByRole('group', { name: 'Assign tags' }));
    await user.click(assignments.getByRole('button', { name: 'Favorites' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Tags could not be saved.');
    expect(assignments.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(assignments.getByRole('button', { name: 'Favorites' }));
    await waitFor(() => expect(assignments.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('false'));
    await user.type(screen.getByLabelText('New tag'), 'Weekend');
    await user.click(screen.getByRole('button', { name: 'Create & assign' }));
    await screen.findByText('Tag created and assigned.');
    expect(assignments.getByRole('button', { name: 'Weekend' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('renames a default and confirms deletion while clearing its active filter', async () => {
    const user = userEvent.setup(); saved = [{ ...makeEntry(), tags: [favorites, revisit] }]; tags = [favorites, revisit];
    renderApp('/library'); await screen.findByRole('button', { name: 'Dune — view details' });
    await user.click(screen.getByRole('button', { name: 'Manage tags' }));
    await user.click(screen.getByRole('button', { name: 'Rename Favorites' }));
    await user.clear(screen.getByRole('textbox', { name: 'Rename Favorites' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Favorites' }), 'Loved');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    const filters = within(screen.getByRole('group', { name: 'Filter by tags' }));
    await user.click(await filters.findByRole('button', { name: 'Loved' }));
    await waitFor(() => expect(getLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ tagIds: [favorites.id] }), expect.any(AbortSignal)));
    await user.click(screen.getByRole('button', { name: 'Delete Loved' }));
    await user.click(screen.getByRole('button', { name: 'Keep tag' }));
    expect(deleteTag).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete Loved' }));
    await user.click(screen.getByRole('button', { name: 'Delete tag' }));
    await waitFor(() => expect(filters.queryByRole('button', { name: 'Loved' })).toBeNull());
    expect(filters.getByRole('button', { name: 'All tags' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(within(screen.getByLabelText('Tags for Dune')).queryByText('Loved')).toBeNull());
    expect(saved[0].tags).toEqual([revisit]);
  });

  it('does not lose tag changes when an earlier status response arrives later', async () => {
    const user = userEvent.setup(); saved = [makeEntry()]; tags = [favorites];
    let finish!: (value: { entry: LibraryEntry }) => void;
    vi.mocked(updateEntryStatus).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    await user.selectOptions(screen.getByLabelText('Library status'), 'completed');
    const assignments = within(screen.getByRole('group', { name: 'Assign tags' }));
    await user.click(assignments.getByRole('button', { name: 'Favorites' }));
    await waitFor(() => expect(assignments.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true'));
    await act(async () => finish({ entry: makeEntry(movie, 'completed') }));
    expect(assignments.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Library status') as HTMLSelectElement).value).toBe('completed');
  });

  it.each(['tmdb', 'igdb', 'openlibrary'])('adds a %s result without leaving search and marks it as saved', async (provider) => {
    const user = userEvent.setup();
    renderApp();
    const selector = await screen.findByLabelText('Data provider');
    await waitFor(() => expect((selector as HTMLSelectElement).value).toBe('tmdb'));
    await user.selectOptions(selector, provider);
    await user.type(screen.getByLabelText('What are you looking for?'), 'Dune{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    await user.selectOptions(screen.getByLabelText('Library status'), 'in_progress');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(await screen.findByText('Added to your library.')).toBeTruthy();
    expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ provider }), 'in_progress');
    expect(screen.queryByRole('button', { name: 'Add to library' })).toBeNull();
    expect(screen.getByText('In your library')).toBeTruthy();
    expect((screen.getByLabelText('Library status') as HTMLSelectElement).value).toBe('in_progress');
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(screen.getByText('In library')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Search' }).getAttribute('aria-current')).toBe('page');
    expect(searchCatalog).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('link', { name: 'Library' }));
    expect(await screen.findByRole('button', { name: 'Dune — view details' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Your library\s*\./ })).toBeTruthy();
  });

  it('loads saved entries on a new app mount and edits their status in place', async () => {
    const user = userEvent.setup(); saved = [makeEntry()];
    renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    expect(screen.queryByRole('button', { name: 'Add to library' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Library status'), 'completed');
    expect(await screen.findByText('Status updated.')).toBeTruthy();
    expect(updateEntryStatus).toHaveBeenCalledWith(saved[0].id, 'completed');
    await user.click(screen.getByRole('button', { name: 'Back to library' }));
    await waitFor(() => expect(within(screen.getByLabelText('Library summary')).getByText('Completed').textContent).toContain('1'));
    cleanup();
    renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    expect((screen.getByLabelText('Library status') as HTMLSelectElement).value).toBe('completed');
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it('keeps unsaved entries retryable after a save fails and disables duplicate clicks while saving', async () => {
    const user = userEvent.setup();
    vi.mocked(saveEntry).mockRejectedValueOnce(new Error('Could not save your entry.'));
    renderApp(); await openMovie(user);
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save your entry.');
    expect(screen.queryByText('In your library')).toBeNull();
    let finish!: (value: Awaited<ReturnType<typeof saveEntry>>) => void;
    vi.mocked(saveEntry).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.dblClick(screen.getByRole('button', { name: 'Add to library' }));
    expect((screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveEntry).toHaveBeenCalledTimes(2);
    await act(async () => finish({ entry: makeEntry(), created: true }));
    expect(await screen.findByText('Added to your library.')).toBeTruthy();
  });

  it('confirms removal, retains a saved entry on failure, and updates the library after success', async () => {
    const user = userEvent.setup(); saved = [makeEntry()];
    vi.mocked(removeEntry).mockRejectedValueOnce(new Error('Please try removing again.'));
    renderApp('/library');
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    await user.click(screen.getByRole('button', { name: 'Remove from library' }));
    await user.click(screen.getByRole('button', { name: 'Keep entry' }));
    expect(removeEntry).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove from library' }));
    await user.click(screen.getByRole('button', { name: 'Remove entry' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please try removing again.');
    expect(screen.getByText('In your library')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove entry' }));
    expect(await screen.findByText('Removed from your library. You can add it again anytime.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to library' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to library' }));
    expect(await screen.findByRole('heading', { name: 'Make room for your favorites.' })).toBeTruthy();
  });

  it('sends search, media, status, and sort filters and can clear an empty result', async () => {
    const user = userEvent.setup(); saved = [makeEntry()];
    renderApp('/library'); await screen.findByRole('button', { name: 'Dune — view details' });
    vi.mocked(getLibrary).mockResolvedValue({ ...response(), entries: [], totalResults: 0 });
    await user.type(screen.getByLabelText('Search your library'), 'Herbert');
    await user.click(screen.getByRole('button', { name: 'Books' }));
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'completed');
    await user.selectOptions(screen.getByLabelText('Sort library'), 'title_asc');
    await waitFor(() => expect(getLibrary).toHaveBeenLastCalledWith({ query: 'Herbert', mediaType: 'book', status: 'completed', sort: 'title_asc', page: 1 }, expect.any(AbortSignal)));
    expect(await screen.findByRole('heading', { name: 'No matching titles' })).toBeTruthy();
    vi.mocked(getLibrary).mockImplementation(async () => response());
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByRole('button', { name: 'Dune — view details' })).toBeTruthy();
    expect((screen.getByLabelText('Search your library') as HTMLInputElement).value).toBe('');
  });

  it('recovers from library loading errors without inventing an empty collection', async () => {
    const user = userEvent.setup();
    vi.mocked(getLibrary).mockRejectedValueOnce(new Error('Database is unavailable.'));
    renderApp('/library');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Database is unavailable.'));
    expect(screen.queryByRole('heading', { name: 'Make room for your favorites.' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Make room for your favorites.' })).toBeTruthy();
  });

  it('keeps external search usable when library status is unavailable and supports retry', async () => {
    const user = userEvent.setup();
    vi.mocked(getLibraryIndex).mockRejectedValueOnce(new Error('Library offline.'));
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Dune' }));
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Library offline.');
    await user.click(screen.getByRole('button', { name: 'Retry library connection' }));
    expect(await screen.findByRole('button', { name: 'Add to library' })).toBeTruthy();
  });
});
