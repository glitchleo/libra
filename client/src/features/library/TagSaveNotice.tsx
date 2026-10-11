import { useLibrary } from './LibraryContext';
import styles from './TagSaveNotice.module.css';

export function TagSaveNotice() {
  const library = useLibrary();
  const failures = Object.entries(library.tagSaves).filter(([, state]) => state.phase === 'error');
  if (!failures.length) return null;
  return <div className={styles.notice} role="alert">
    <span>{failures[0][1].error} Your tag changes are still pending.</span>
    <button type="button" onClick={() => void library.flushTags().catch(() => {})}>Retry tags</button>
  </div>;
}
