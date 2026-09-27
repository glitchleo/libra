import { useEffect, useId, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useLibrary } from './LibraryContext';
import styles from './Tags.module.css';

export function DraftTags({ value, onChange, onBusyChange }: { value: string[]; onChange(ids: string[]): void; onBusyChange(busy: boolean): void }) {
  const library = useLibrary();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputId = useId();
  useEffect(() => {
    if (!library.ready) return;
    const next = value.filter((id) => library.tags.some((tag) => tag.id === id));
    if (next.length !== value.length) onChange(next);
  }, [library.ready, library.tags, value, onChange]);
  async function create() {
    if (busy || !name.trim() || value.length >= 50) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const tag = await library.createTag(name);
      onChange([...new Set([...value, tag.id])]); setName('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create this tag.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <div>
    {!library.ready && !library.error && <p className={styles.hint}>Loading tags…</p>}
    {library.error && <p className={styles.error} role="alert">{library.error} <button className={styles.button} type="button" onClick={() => void library.refresh()}>Reload tags</button></p>}
    <div className={styles.chips} role="group" aria-label="Tags for new entry">{library.tags.map((tag) => <button key={tag.id} className={styles.chip} type="button" aria-pressed={value.includes(tag.id)} disabled={busy || (value.length >= 50 && !value.includes(tag.id))} onClick={() => onChange(value.includes(tag.id) ? value.filter((id) => id !== tag.id) : [...value, tag.id])}>{value.includes(tag.id) && <Check size={13} aria-hidden="true" />}{tag.name}</button>)}</div>
    {library.ready && <div className={styles.create} style={{ marginTop: 18 }}>
      <label className={styles.field} htmlFor={inputId}>Create a new tag<input id={inputId} className={styles.input} maxLength={40} value={name} disabled={busy} placeholder="e.g. Weekend reads" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void create(); } }} /></label>
      <button type="button" className={styles.button} disabled={busy || !name.trim() || value.length >= 50} onClick={() => void create()}><Plus size={14} aria-hidden="true" />{busy ? 'Creating…' : 'Create & select'}</button>
    </div>}
    {value.length > 0 && <p className={styles.message}>{value.length} {value.length === 1 ? 'tag' : 'tags'} selected. Saved together with your entry.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
