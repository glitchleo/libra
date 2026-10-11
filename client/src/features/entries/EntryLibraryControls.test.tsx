// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@libra/shared/search';
import type { LibraryEntry } from '@libra/shared/library';
import { EntryLibraryControls } from './EntryLibraryControls';
import { PreferencesProvider } from '../settings/PreferencesContext';
import { useLibrary } from '../library/LibraryContext';

vi.mock('../library/LibraryContext', () => ({ useLibrary: vi.fn() }));

const item: CatalogItem = { provider: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'First title', originalTitle: '', overview: '', releaseDate: null, posterUrl: null, externalUrl: '', rating: null, voteCount: 0 };
let saved: LibraryEntry | undefined;
const save = vi.fn();
const update = vi.fn();

function controls(sourceId: string) {
  return <PreferencesProvider><EntryLibraryControls key={sourceId} item={{ ...item, sourceId }} /></PreferencesProvider>;
}

beforeEach(() => {
  localStorage.clear(); saved = undefined;
  save.mockResolvedValue(undefined); update.mockResolvedValue(undefined);
  vi.mocked(useLibrary).mockReturnValue({ ready: true, error: '', find: () => saved, save, update } as unknown as ReturnType<typeof useLibrary>);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('new entry status', () => {
  it('uses the last chosen add status across entry panels and restores the saved preference after refresh', async () => {
    localStorage.setItem('libra.preferences.v1', JSON.stringify({ defaultStatus: 'in_progress' }));
    const user = userEvent.setup();
    const view = render(controls('1'));
    expect(screen.getByLabelText('Library status')).toHaveProperty('value', 'in_progress');
    await user.selectOptions(screen.getByLabelText('Library status'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '1' }), 'completed');
    view.rerender(controls('2'));
    expect(screen.getByLabelText('Library status')).toHaveProperty('value', 'completed');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: '2' }), 'completed');
    cleanup(); render(controls('3'));
    expect(screen.getByLabelText('Library status')).toHaveProperty('value', 'in_progress');
  });

  it('does not change the add default when editing the status of an existing library entry', async () => {
    const user = userEvent.setup(); const view = render(controls('1'));
    await user.selectOptions(screen.getByLabelText('Library status'), 'completed');
    saved = { id: 'saved-entry', status: 'planned' } as LibraryEntry;
    view.rerender(controls('2'));
    await user.selectOptions(screen.getByLabelText('Library status'), 'on_hold');
    expect(update).toHaveBeenCalledWith('saved-entry', 'on_hold');
    saved = undefined; view.rerender(controls('3'));
    expect(screen.getByLabelText('Library status')).toHaveProperty('value', 'completed');
  });
});
