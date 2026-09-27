// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../app/App';
import { getLibrary, getLibraryIndex } from '../library/library.api';
import { downloadBackup, exportLibrary, importLibrary, previewImport } from './backup.api';
import { backupMaxBytes } from '@libra/shared/library';
import type { LibraryBackup, LibraryEntry } from '@libra/shared/library';

vi.mock('../library/library.api', () => ({ getLibrary: vi.fn(), getLibraryIndex: vi.fn() }));
vi.mock('./backup.api', () => ({ downloadBackup: vi.fn(), exportLibrary: vi.fn(), importLibrary: vi.fn(), previewImport: vi.fn() }));
const entry: LibraryEntry = { id: '77d86a44-77c5-4c25-a0b1-29031f580009', providerName: 'Manual entry', status: 'planned', tags: [], addedAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', item: { provider: 'manual', sourceId: '77d86a44-77c5-4c25-a0b1-29031f580008', mediaType: 'book', title: 'The Lantern Atlas', originalTitle: '', overview: 'A wonderful journey.', releaseDate: null, posterUrl: null, externalUrl: '', rating: null, voteCount: 0 } };
const backup: LibraryBackup = { format: 'libra-library', version: 1, exportedAt: '2026-09-27T12:00:00Z', tags: [], entries: [entry] };
const summary = { totalEntries: 1, totalTags: 0, added: 1, updated: 0, kept: 0, restored: 0, tagsAdded: 0 };
const file = (text = JSON.stringify(backup)) => {
  const value = new File([text], 'libra-backup.json', { type: 'application/json' });
  Object.defineProperty(value, 'text', { value: async () => text }); return value;
};
function renderApp(path = '/settings') { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
beforeEach(() => {
  localStorage.clear();
  vi.mocked(getLibraryIndex).mockResolvedValue({ entries: [], tags: [] });
  vi.mocked(getLibrary).mockResolvedValue({ entries: [entry], page: 1, totalPages: 1, totalResults: 1, summary: { total: 1, byStatus: { planned: 1 } } });
  vi.mocked(exportLibrary).mockResolvedValue(backup);
  vi.mocked(previewImport).mockResolvedValue({ summary });
  vi.mocked(importLibrary).mockResolvedValue({ summary });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('settings and library preferences', () => {
  it('persists display choices, applies default sort/status, and keeps view controls in sync', async () => {
    const user = userEvent.setup(); renderApp();
    await user.selectOptions(screen.getByLabelText('Library layout'), 'list');
    await user.selectOptions(screen.getByLabelText('Default library sort'), 'title_asc');
    await user.selectOptions(screen.getByLabelText('Default status for new entries'), 'in_progress');
    await user.click(screen.getByLabelText('Show descriptions'));
    await user.click(screen.getByLabelText('Reduce animations'));
    await user.click(screen.getByRole('link', { name: 'Library' }));
    await screen.findByRole('button', { name: 'The Lantern Atlas — view details' });
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('A wonderful journey.')).toBeNull();
    expect(getLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'title_asc' }), expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Small covers' }));
    cleanup(); renderApp();
    expect((screen.getByLabelText('Library layout') as HTMLSelectElement).value).toBe('small');
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    await user.click(screen.getByRole('link', { name: 'Add entry' }));
    expect((screen.getByLabelText('Library status') as HTMLSelectElement).value).toBe('in_progress');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Reset display preferences' }));
    expect((screen.getByLabelText('Library layout') as HTMLSelectElement).value).toBe('large');
    expect((screen.getByLabelText('Default status for new entries') as HTMLSelectElement).value).toBe('planned');
  });

  it('handles corrupt saved preferences and honors a saved start page', async () => {
    localStorage.setItem('libra.preferences.v1', '{bad'); renderApp();
    expect((screen.getByLabelText('Library layout') as HTMLSelectElement).value).toBe('large');
    const user = userEvent.setup(); await user.selectOptions(screen.getByLabelText('Start page'), '/library');
    cleanup(); renderApp('/');
    expect(await screen.findByRole('heading', { name: /Your library\s*\./ })).toBeTruthy();
  });

  it('exports the complete API payload and reports failed downloads without a false success', async () => {
    const user = userEvent.setup(); renderApp();
    vi.mocked(exportLibrary).mockRejectedValueOnce(new Error('Backup unavailable.'));
    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Backup unavailable.');
    expect(downloadBackup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    await screen.findByText(/Backup download started/);
    expect(downloadBackup).toHaveBeenCalledWith(backup);
  });

  it('previews before importing, invalidates the preview when mode changes, and retries an import failure', async () => {
    const user = userEvent.setup(); renderApp();
    await user.upload(screen.getByLabelText('Backup file'), file());
    expect(importLibrary).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('heading', { name: 'Ready to import' });
    expect(previewImport).toHaveBeenCalledWith(backup, 'keep');
    expect(importLibrary).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('When an entry already exists'), 'update');
    expect(screen.queryByRole('heading', { name: 'Ready to import' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('heading', { name: 'Ready to import' });
    vi.mocked(importLibrary).mockRejectedValueOnce(new Error('Import failed. No changes saved.'));
    await user.click(screen.getByRole('button', { name: 'Import into library' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Import failed. No changes saved.');
    await user.click(screen.getByRole('button', { name: 'Import into library' }));
    await screen.findByText(/Import complete: 1 added/);
    expect(importLibrary).toHaveBeenLastCalledWith(backup, 'update');
    expect(getLibraryIndex).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Import into library' })).toBeNull();
  });

  it('rejects malformed and oversized files before sending them, and cancelling never imports', async () => {
    const user = userEvent.setup(); renderApp();
    await user.upload(screen.getByLabelText('Backup file'), file('{no}'));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('not valid JSON'));
    expect(previewImport).not.toHaveBeenCalled();
    const oversized = file(); Object.defineProperty(oversized, 'size', { value: backupMaxBytes + 1 });
    await user.upload(screen.getByLabelText('Backup file'), oversized);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('25 MB'));
    expect(previewImport).not.toHaveBeenCalled();
    await user.upload(screen.getByLabelText('Backup file'), file());
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    const preview = await screen.findByLabelText('Import preview');
    await user.click(within(preview).getByRole('button', { name: 'Cancel' }));
    expect(importLibrary).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Import preview')).toBeNull();
  });
});
