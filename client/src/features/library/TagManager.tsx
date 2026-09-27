import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { LibraryTag } from '@libra/shared/library';
import { useLibrary } from './LibraryContext';
import { TagCreateForm } from './TagCreateForm';
import styles from './Tags.module.css';

function TagRow({ tag }: { tag: LibraryTag }) {
  const library = useLibrary();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); setEditing(false); setConfirm(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this tag.'); }
    finally { setBusy(false); }
  }
  return <li>
    <form className={styles.row} onSubmit={(event) => { event.preventDefault(); if (!busy && name.trim()) void run(() => library.renameTag(tag.id, name)); }}>
      {editing ? <>
        <input aria-label={'Rename ' + tag.name} className={styles.input} value={name} maxLength={40} required disabled={busy} onChange={(event) => setName(event.target.value)} autoFocus />
        <button className={styles.button} disabled={busy || !name.trim()} type="submit">Save name</button>
        <button className={styles.iconButton} disabled={busy} type="button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
      </> : <>
        <span className={styles.name}>{tag.name}</span>
        <button className={styles.iconButton} aria-label={'Rename ' + tag.name} disabled={busy} type="button" onClick={() => { setName(tag.name); setEditing(true); setConfirm(false); setError(''); }}><Pencil size={14} aria-hidden="true" /></button>
        <button className={styles.iconButton} aria-label={'Delete ' + tag.name} disabled={busy} type="button" onClick={() => { setConfirm(true); setError(''); }}><Trash2 size={14} aria-hidden="true" /></button>
      </>}
      {confirm && <div className={styles.confirmation}>
        <p>Delete “{tag.name}”? It will be removed from all entries. Your entries will stay in your library.</p>
        <button className={`${styles.button} ${styles.danger}`} type="button" disabled={busy} onClick={() => void run(() => library.deleteTag(tag.id))}>Delete tag</button>
        <button className={styles.button} type="button" disabled={busy} onClick={() => setConfirm(false)}>Keep tag</button>
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  </li>;
}

export function TagManager() {
  const library = useLibrary();
  return <section id="tag-manager" aria-label="Manage tags" className={styles.panel}>
    <p className={styles.hint}>Make your collection your own. Default tags can be renamed or deleted, too.</p>
    <TagCreateForm onCreate={library.createTag} />
    {library.tags.length > 0 && <ul className={styles.list}>{library.tags.map((tag) => <TagRow key={tag.id} tag={tag} />)}</ul>}
  </section>;
}
