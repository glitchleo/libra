import { useState } from 'react';
import { Check, Tag } from 'lucide-react';
import type { CatalogItem } from '@libra/shared/search';
import { useLibrary } from '../library/LibraryContext';
import { TagCreateForm } from '../library/TagCreateForm';
import styles from '../library/Tags.module.css';

export function EntryTags({ item }: { item: CatalogItem }) {
  const library = useLibrary();
  const saved = library.find(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!saved) return null;
  async function toggle(id: string) {
    if (!saved || busy) return;
    setBusy(true); setError(''); setMessage('');
    const selected = saved.tagIds.includes(id);
    try { await library.setTags(saved.id, selected ? saved.tagIds.filter((tagId) => tagId !== id) : [...saved.tagIds, id]); setMessage(selected ? 'Tag removed.' : 'Tag assigned.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your tags. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className={styles.editor} aria-label="Entry tags">
    <div className={styles.heading}><h3><Tag size={15} aria-hidden="true" />Your tags</h3></div>
    <p className={styles.hint}>Choose tags for this title. Changes save automatically.</p>
    <div className={styles.chips} role="group" aria-label="Assign tags">
      {library.tags.map((tag) => <button key={tag.id} className={styles.chip} type="button" aria-pressed={saved.tagIds.includes(tag.id)} disabled={busy || (saved.tagIds.length >= 50 && !saved.tagIds.includes(tag.id))} onClick={() => void toggle(tag.id)}>{saved.tagIds.includes(tag.id) && <Check size={13} aria-hidden="true" />}{tag.name}</button>)}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {(busy || message) && <p className={styles.message} role="status">{busy ? 'Saving tags…' : message}</p>}
    {saved.tagIds.length >= 50 && <p className={styles.hint}>This title has reached the limit of 50 tags.</p>}
    <TagCreateForm assign disabled={busy || saved.tagIds.length >= 50} onCreate={async (name) => {
      setBusy(true); setError(''); setMessage('');
      try {
        const tag = await library.createTag(name);
        await library.setTags(saved.id, [...new Set([...saved.tagIds, tag.id])]);
      } finally { setBusy(false); }
    }} />
  </section>;
}
