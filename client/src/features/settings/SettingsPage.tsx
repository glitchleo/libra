import { useRef, useState } from 'react';
import { Download, Upload, SlidersHorizontal, Database, Accessibility, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { backupMaxBytes, libraryStatuses } from '@libra/shared/library';
import type { ImportMode, ImportSummary, LibrarySort, LibraryStatus } from '@libra/shared/library';
import { useLibrary } from '../library/LibraryContext';
import { statusLabels } from '../library/library-status';
import { usePreferences } from './PreferencesContext';
import type { LibraryView } from './PreferencesContext';
import { downloadBackup, exportLibrary, previewImport } from './backup.api';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const { preferences, update, reset, storageError } = usePreferences();
  const library = useLibrary();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('keep');
  const [preview, setPreview] = useState<{ backup: unknown; summary: ImportSummary } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastExport, setLastExport] = useState(() => { try { return localStorage.getItem('libra.lastExport') ?? ''; } catch { return ''; } });
  const fileInput = useRef<HTMLInputElement>(null);
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this action. Please try again.'); }
    finally { setBusy(''); }
  }
  return <main id="main-content" className={styles.page}>
    <header className={styles.heading}><div className={styles.eyebrow}>MAKE YOURSELF AT HOME</div><h1>Settings<span>.</span></h1><p>Your collection, your way. Small preferences and a safe place for your backups.</p></header>
    <section className={styles.section} aria-labelledby="display-settings">
      <div className={styles.intro}><SlidersHorizontal size={22} aria-hidden="true" /><h2 id="display-settings">Library & display</h2><p>Saved automatically in this browser.</p></div>
      <div className={styles.panel}>
        <div className={styles.fields}>
          <label>Library layout<select value={preferences.view} onChange={(event) => update({ view: event.target.value as LibraryView })}><option value="large">Large covers</option><option value="small">Small covers</option><option value="list">List with thumbnails</option></select></label>
          <label>Default library sort<select value={preferences.sort} onChange={(event) => update({ sort: event.target.value as LibrarySort })}><option value="added_desc">Recently added</option><option value="title_asc">Title A–Z</option><option value="rating_desc">Catalog rating</option></select></label>
          <label>Default status for new entries<select value={preferences.defaultStatus} onChange={(event) => update({ defaultStatus: event.target.value as LibraryStatus })}>{libraryStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          <label>Start page<select value={preferences.home} onChange={(event) => update({ home: event.target.value as '/search' | '/library' })}><option value="/search">Search</option><option value="/library">My library</option></select></label>
        </div>
        <div className={styles.toggles}>{([['descriptions', 'Show descriptions'], ['ratings', 'Show catalog ratings'], ['tags', 'Show tags on library cards']] as const).map(([key, label]) => <label className={styles.toggle} key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => update({ [key]: event.target.checked })} /></label>)}</div>
        {storageError && <p role="status" className={styles.note}>{storageError}</p>}
      </div>
    </section>
    <section className={styles.section} aria-labelledby="backup-settings">
      <div className={styles.intro}><Database size={22} aria-hidden="true" /><h2 id="backup-settings">Library backups</h2><p>Take your collection with you.</p></div>
      <div className={styles.panel}>
        <h3>Export your library</h3><p className={styles.note}>Download all saved entries and tags, including descriptions, media details, statuses, and dates. Covers are saved as image links. Removed entries and browser preferences are excluded.</p>
        <button className={styles.primary} type="button" disabled={!!busy} onClick={() => void run('export', async () => {
          const backup = await exportLibrary(); downloadBackup(backup); setLastExport(backup.exportedAt);
          try { localStorage.setItem('libra.lastExport', backup.exportedAt); } catch { /* Export still works without browser storage. */ }
          setMessage('Backup download started. Keep the JSON file somewhere safe.');
        })}><Download size={16} aria-hidden="true" />{busy === 'export' ? 'Preparing backup…' : 'Export JSON'}</button>
        {lastExport && Number.isFinite(Date.parse(lastExport)) && <p className={styles.note}>Last export requested: {new Date(lastExport).toLocaleString()}</p>}
        <div className={styles.import}>
          <h3>Import a backup</h3><p className={styles.note}>Choose a Libra JSON backup (up to 25 MB and 10,000 entries). Review the changes before importing. Entries outside the file stay in your library.</p>
          <label className={styles.file}>Backup file<input ref={fileInput} type="file" accept=".json,application/json" disabled={!!busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(''); setMessage(''); }} /></label>
          <label className={styles.conflicts}>When an entry already exists<select disabled={!!busy} value={mode} onChange={(event) => { setMode(event.target.value as ImportMode); setPreview(null); setMessage(''); }}><option value="keep">Keep my existing entry and tags</option><option value="update">Use the backup entry and its tags</option></select></label>
          <p className={styles.note}>Matching uses catalog IDs, or the original ID of a custom entry. Previously removed matches are restored. Tags with the same name are reused.</p>
          <button type="button" className={styles.button} disabled={!file || !!busy} onClick={() => void run('preview', async () => {
            setPreview(null);
            if (!file || file.size > backupMaxBytes) throw new Error('Choose a JSON backup smaller than 25 MB.');
            let backup: unknown;
            try { backup = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('This file is not valid JSON. Choose an exported Libra backup.'); }
            const result = await previewImport(backup, mode); setPreview({ backup, summary: result.summary });
          })}><Upload size={16} aria-hidden="true" />{busy === 'preview' ? 'Checking file…' : 'Preview import'}</button>
          {preview && <div className={styles.preview} aria-label="Import preview">
            <h4>Ready to import</h4><p>{preview.summary.totalEntries} entries · {preview.summary.totalTags} tags in this file</p>
            <dl>{([['Add', preview.summary.added], ['Update', preview.summary.updated], ['Keep existing', preview.summary.kept], ['Restore', preview.summary.restored], ['New tags', preview.summary.tagsAdded]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {mode === 'update' && preview.summary.updated > 0 && <p>Matching entries will take the descriptions, details, status, dates, and tags from this file. Export your current library first if you want to keep a copy.</p>}
            <button type="button" className={styles.primary} disabled={!!busy} onClick={() => void run('import', async () => {
              const summary = await library.importBackup(preview.backup, mode);
              setMessage(`Import complete: ${summary.added} added, ${summary.updated} updated, ${summary.kept} kept, ${summary.restored} restored, and ${summary.tagsAdded} new tags.`);
              setPreview(null); setFile(null); if (fileInput.current) fileInput.current.value = '';
            })}>{busy === 'import' ? 'Importing…' : 'Import into library'}</button>
            <button type="button" className={styles.button} disabled={!!busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {message && <p className={styles.message} role="status">{message} {message.startsWith('Import complete') && <Link to="/library">View library</Link>}</p>}
      </div>
    </section>
    <section className={styles.section} aria-labelledby="accessibility-settings">
      <div className={styles.intro}><Accessibility size={22} aria-hidden="true" /><h2 id="accessibility-settings">Comfort & controls</h2><p>A calmer experience when you need it.</p></div>
      <div className={styles.panel}>
        <label className={styles.toggle}><span>Reduce animations</span><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => update({ reducedMotion: event.target.checked })} /></label>
        <p className={styles.note}>Your device’s reduced-motion preference is also respected. Entry details support Escape to close and keyboard navigation.</p>
        <button className={styles.button} type="button" onClick={reset}><RotateCcw size={15} aria-hidden="true" />Reset display preferences</button>
        <p className={styles.note}>Resets only the preferences on this page. Your library and tags stay as they are.</p>
      </div>
    </section>
  </main>;
}
