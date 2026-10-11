import { Check, Tag } from 'lucide-react';
import type { CatalogItem } from '@libra/shared/search';
import { useLibrary } from '../library/LibraryContext';
import { TagCreateForm } from '../library/TagCreateForm';
import styles from '../library/Tags.module.css';

export function EntryTags({ item }: { item: CatalogItem }) {
  const library = useLibrary();
  const saved = library.find(item);
  if (!saved) return null;
  const saving = library.tagSaves[saved.id];
  function toggle(id: string) {
    if (!saved) return;
    const selected = saved.tagIds.includes(id);
    library.setTags(saved.id, selected ? saved.tagIds.filter((tagId) => tagId !== id) : [...saved.tagIds, id]);
  }
  return <section className={styles.editor} aria-label="Entry tags">
    <div className={styles.heading}><h3><Tag size={15} aria-hidden="true" />Tags</h3></div>
    <div className={styles.chips} role="group" aria-label="Assign tags">
      {library.tags.map((tag) => <button key={tag.id} className={styles.chip} type="button" aria-pressed={saved.tagIds.includes(tag.id)} disabled={saved.tagIds.length >= 50 && !saved.tagIds.includes(tag.id)} onClick={() => toggle(tag.id)}>{saved.tagIds.includes(tag.id) && <Check size={13} aria-hidden="true" />}{tag.name}</button>)}
    </div>
    {saving?.phase === 'error'
      ? <p className={styles.error}>{saving.error} <button className={styles.button} type="button" onClick={() => void library.retryTags(saved.id).catch(() => {})}>Retry tags</button></p>
      : saving && <p className={styles.message} role="status">{saving.phase === 'saving' ? 'Saving tags…' : 'Tags pending'}</p>}
    {saved.tagIds.length >= 50 && <p className={styles.hint}>50 tags maximum</p>}
    <TagCreateForm assign disabled={saved.tagIds.length >= 50} onCreate={async (name) => {
      const tag = await library.createTag(name);
      const current = library.find(item);
      if (current) library.setTags(current.id, [...new Set([...current.tagIds, tag.id])]);
    }} />
  </section>;
}
