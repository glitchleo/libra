// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { LibraryEntry } from '@libra/shared/library';
import { App } from '../../app/App';
import { createManualEntry, createTag, getLibrary, getLibraryIndex, removeEntry, restoreEntry } from '../library/library.api';

vi.mock('../library/library.api', () => ({ createManualEntry: vi.fn(), createTag: vi.fn(), getLibrary: vi.fn(), getLibraryIndex: vi.fn(), removeEntry: vi.fn(), restoreEntry: vi.fn(), saveEntry: vi.fn(), updateEntryStatus: vi.fn() }));
let saved: LibraryEntry[];
let lastEntry: LibraryEntry;
const entryId = 'd551171e-f3d2-4ce5-9233-7a4abc2a9f98';
function renderApp(state?: unknown) { return render(<MemoryRouter initialEntries={[{ pathname: '/entry', state }]}><App /></MemoryRouter>); }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector('button')?.focus(); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => {
  localStorage.clear();
  saved = [];
  vi.mocked(getLibraryIndex).mockImplementation(async () => ({ tags: [], entries: saved.map((entry) => ({ id: entry.id, provider: entry.item.provider, sourceId: entry.item.sourceId, mediaType: entry.item.mediaType, status: entry.status, tagIds: entry.tags.map((tag) => tag.id) })) }));
  vi.mocked(getLibrary).mockImplementation(async () => ({ entries: saved, page: 1, totalPages: 1, totalResults: saved.length, summary: { total: saved.length, byStatus: { planned: saved.length } } }));
  vi.mocked(createManualEntry).mockImplementation(async (input) => {
    lastEntry = { id: entryId, tags: [], providerName: 'Manual entry', addedAt: '2026-09-25', updatedAt: '2026-09-25', status: input.status, details: input.details,
      item: { provider: 'manual', sourceId: input.requestId, mediaType: input.mediaType, title: input.title, originalTitle: input.originalTitle, overview: input.description, releaseDate: input.releaseDate, posterUrl: input.coverUrl, externalUrl: input.websiteUrl ?? '', rating: null, voteCount: 0 } };
    saved = [lastEntry]; return { entry: lastEntry, created: true };
  });
  vi.mocked(removeEntry).mockImplementation(async () => { saved = []; return { removed: true }; });
  vi.mocked(restoreEntry).mockImplementation(async () => { saved = [lastEntry]; return { entry: lastEntry }; });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('manual entry page', () => {
  it('selects existing tags, creates a new one without submitting, and sends all tags with the entry', async () => {
    const user = userEvent.setup();
    const favorite = { id: '77d86a44-77c5-4c25-a0b1-29031f580001', name: 'Favorites' };
    const weekend = { id: '77d86a44-77c5-4c25-a0b1-29031f580005', name: 'Weekend reads' };
    vi.mocked(getLibraryIndex).mockResolvedValue({ entries: [], tags: [favorite] });
    vi.mocked(createTag).mockResolvedValue({ tag: weekend, created: true });
    renderApp();
    await user.type(screen.getByRole('textbox', { name: /Title.*required/i }), 'A local story');
    await user.click(await screen.findByRole('button', { name: 'Favorites' }));
    await user.type(screen.getByLabelText('Create a new tag'), 'Weekend reads{Enter}');
    expect(createManualEntry).not.toHaveBeenCalled();
    expect((await screen.findByRole('button', { name: 'Weekend reads' })).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    await screen.findByRole('heading', { name: 'Added to your library' });
    expect(createManualEntry).toHaveBeenCalledWith(expect.objectContaining({ tagIds: [favorite.id, weekend.id] }));
    await user.click(screen.getByRole('button', { name: 'Add another entry' }));
    expect(screen.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['Movie', 'Director', 'Runtime (minutes)'], ['Series', 'Creator', 'Seasons'], ['Anime', 'Studio', 'Episodes'],
    ['Book', 'Author', 'Pages'], ['Manga', 'Artist', 'Chapters'], ['Manhwa', 'Artist', 'Volumes'],
    ['Game', 'Developer', 'Platforms'], ['Audiobook', 'Narrator', 'Duration (minutes)'], ['Other', 'Creator', 'Format'],
  ])('offers the relevant optional fields for %s', async (type, field, extra) => {
    const user = userEvent.setup(); renderApp();
    await user.click(screen.getByRole('button', { name: type }));
    expect(screen.getByLabelText(field)).toBeTruthy();
    expect(screen.getByLabelText(extra)).toBeTruthy();
    expect((screen.getByLabelText(field) as HTMLInputElement).required).toBe(false);
  });

  it('saves book details, opens them on this screen and in the library, and restores a removed entry', async () => {
    const user = userEvent.setup(); renderApp();
    await user.click(screen.getByRole('button', { name: 'Book' }));
    await user.type(screen.getByRole('textbox', { name: /Title.*required/i }), 'The Lantern Atlas');
    await user.type(screen.getByLabelText('Description'), 'An independent story.\nA second line.');
    await user.type(screen.getByLabelText('Author'), 'Mira Example');
    await user.type(screen.getByLabelText('Pages'), '144');
    await user.type(screen.getByLabelText('Publication date'), '2024');
    await user.selectOptions(screen.getByLabelText('Library status'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(await screen.findByRole('heading', { name: 'Added to your library' })).toBeTruthy();
    expect(createManualEntry).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'book', title: 'The Lantern Atlas', status: 'completed', releaseDate: '2024', details: { author: 'Mira Example', pages: 144 }, coverUrl: null, websiteUrl: null }));
    await user.click(screen.getByRole('button', { name: 'View entry' }));
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Mira Example')).toBeTruthy();
    expect(dialog.getByText('144')).toBeTruthy();
    expect(dialog.queryByText('Community rating')).toBeNull();
    expect(dialog.queryByRole('link')).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Back to add entry' }));
    await user.click(screen.getByRole('link', { name: 'View library' }));
    await user.click(await screen.findByRole('button', { name: 'The Lantern Atlas — view details' }));
    dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Mira Example')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Remove from library' }));
    await user.click(dialog.getByRole('button', { name: 'Remove entry' }));
    await user.click(await dialog.findByRole('button', { name: 'Restore to library' }));
    expect(await dialog.findByText('Restored to your library.')).toBeTruthy();
    expect(restoreEntry).toHaveBeenCalledWith(entryId);
    expect(dialog.queryByRole('button', { name: 'Add to library' })).toBeNull();
  });

  it('accepts a title alone, omits hidden fields after a type switch, and starts the next entry with a new identity', async () => {
    const user = userEvent.setup(); renderApp({ manualTitle: 'Small game', manualMediaType: 'game' });
    expect(screen.getByLabelText('Developer')).toBeTruthy();
    await user.type(screen.getByLabelText('Developer'), 'Not a film credit');
    await user.click(screen.getByRole('button', { name: 'Movie' }));
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    await screen.findByRole('heading', { name: 'Added to your library' });
    expect(createManualEntry).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Small game', mediaType: 'movie', details: {}, releaseDate: null }));
    const firstId = vi.mocked(createManualEntry).mock.calls[0][0].requestId;
    await user.click(screen.getByRole('button', { name: 'Add another entry' }));
    expect((screen.getByRole('textbox', { name: /Title.*required/i }) as HTMLInputElement).value).toBe('');
    await user.type(screen.getByRole('textbox', { name: /Title.*required/i }), 'Another title');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    await screen.findByRole('heading', { name: 'Added to your library' });
    expect(vi.mocked(createManualEntry).mock.calls[1][0].requestId).not.toBe(firstId);
  });

  it('retains fields and the request identity after failure and blocks duplicate submissions while saving', async () => {
    const user = userEvent.setup(); renderApp();
    await user.type(screen.getByRole('textbox', { name: /Title.*required/i }), 'My rare film');
    await user.type(screen.getByLabelText('Director'), 'A filmmaker');
    vi.mocked(createManualEntry).mockRejectedValueOnce(new Error('Please try saving again.'));
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please try saving again.');
    expect((screen.getByLabelText('Director') as HTMLInputElement).value).toBe('A filmmaker');
    const requestId = vi.mocked(createManualEntry).mock.calls[0][0].requestId;
    let reject!: (error: Error) => void;
    vi.mocked(createManualEntry).mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await user.dblClick(screen.getByRole('button', { name: 'Add to library' }));
    expect((screen.getByRole('button', { name: 'Saving entry…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(createManualEntry).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createManualEntry).mock.calls[1][0].requestId).toBe(requestId);
    await act(async () => reject(new Error('Still unavailable.')));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Still unavailable.');
  });

  it('requires a nonblank title and prevents invalid number submissions', async () => {
    const user = userEvent.setup(); renderApp();
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(createManualEntry).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: /Title.*required/i }), '   ');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Enter a title.');
    await user.clear(screen.getByRole('textbox', { name: /Title.*required/i }));
    await user.type(screen.getByRole('textbox', { name: /Title.*required/i }), 'Short film');
    await user.type(screen.getByLabelText('Runtime (minutes)'), '-1');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(createManualEntry).not.toHaveBeenCalled();
  });
});
