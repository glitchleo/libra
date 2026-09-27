import type { ImportMode, ImportSummary, LibraryBackup } from '@libra/shared/library';
import { getJson, sendJson } from '../../api/client';

export const exportLibrary = () => getJson<LibraryBackup>('/api/entries/backup');
export const previewImport = (backup: unknown, mode: ImportMode) => sendJson<{ summary: ImportSummary }>('/api/entries/backup/preview', 'POST', { backup, mode });
export const importLibrary = (backup: unknown, mode: ImportMode) => sendJson<{ summary: ImportSummary }>('/api/entries/backup/import', 'POST', { backup, mode });
export function downloadBackup(backup: LibraryBackup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'libra-library-' + backup.exportedAt.slice(0, 10) + '.json';
  document.body.append(anchor); anchor.click(); anchor.remove();
  // Give mobile browsers time to begin the download before releasing the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
