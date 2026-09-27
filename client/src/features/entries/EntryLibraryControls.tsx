import { useState } from 'react';
import { Check, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { CatalogItem } from '@libra/shared/search';
import { libraryStatuses } from '@libra/shared/library';
import type { LibraryStatus } from '@libra/shared/library';
import { useLibrary } from '../library/LibraryContext';
import { statusLabels } from '../library/library-status';
import styles from './EntryPreview.module.css';
import { usePreferences } from '../settings/PreferencesContext';

export function EntryLibraryControls({ item, entryId }: { item: CatalogItem; entryId?: string }) {
  const library = useLibrary();
  const { preferences } = usePreferences();
  const saved = library.find(item);
  const [status, setStatus] = useState<LibraryStatus>(preferences.defaultStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const manual = item.provider === 'manual';

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(success); setConfirmRemove(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update your library. Please try again.'); }
    finally { setBusy(false); }
  }

  if (!library.ready && !saved) return <div className={styles.libraryControls}>
    {library.error ? <><p role="alert" className={styles.actionError}>{library.error}</p><button type="button" className={styles.libraryButton} onClick={() => void library.refresh()}>Retry library connection</button></>
      : <p role="status" className={styles.actionMessage}>Checking your library…</p>}
  </div>;

  return <div className={styles.libraryControls} aria-label="Library actions">
    {saved && <div className={styles.savedLabel}><Check size={15} aria-hidden="true" />In your library</div>}
    {(!manual || saved) && <label className={styles.statusField}>Library status
      <select value={saved?.status ?? status} disabled={busy} onChange={(event) => {
        const next = event.target.value as LibraryStatus;
        if (saved) void run(() => library.update(saved.id, next), 'Status updated.');
        else setStatus(next);
      }}>{libraryStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select>
    </label>}
    {!saved && !manual && <button type="button" className={styles.libraryButton} disabled={busy} onClick={() => void run(() => library.save(item, status), 'Added to your library.')}>
      {busy ? <LoaderCircle size={16} className={styles.spin} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{busy ? 'Adding…' : 'Add to library'}
    </button>}
    {!saved && manual && entryId && <button type="button" className={styles.libraryButton} disabled={busy} onClick={() => void run(() => library.restore(entryId), 'Restored to your library.')}><Plus size={16} aria-hidden="true" />{busy ? 'Restoring…' : 'Restore to library'}</button>}
    {saved && !confirmRemove && <button type="button" className={styles.removeButton} disabled={busy} onClick={() => { setConfirmRemove(true); setMessage(''); }}><Trash2 size={13} aria-hidden="true" />Remove from library</button>}
    {saved && confirmRemove && <div className={styles.removeConfirmation}>
      <p>{manual ? 'Remove this entry from your library? You can restore it from this panel before closing.' : 'Remove this entry from your library? Adding it again restores its status.'}</p>
      <button type="button" disabled={busy} onClick={() => void run(() => library.remove(saved.id), manual ? 'Removed from your library. Restore it here before closing if you change your mind.' : 'Removed from your library. You can add it again anytime.')}>{busy ? 'Removing…' : 'Remove entry'}</button>
      <button type="button" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep entry</button>
    </div>}
    {busy && saved && <p className={styles.actionMessage} role="status">Saving changes…</p>}
    {message && <p className={styles.actionMessage} role="status">{message}</p>}
    {error && <p className={styles.actionError} role="alert">{error}</p>}
  </div>;
}
