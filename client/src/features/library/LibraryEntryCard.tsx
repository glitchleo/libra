import { useState } from 'react';
import { Star } from 'lucide-react';
import type { LibraryEntry } from '@libra/shared/library';
import { usePreferences } from '../settings/PreferencesContext';
import { mediaPresentation } from '../search/media-types';
import { statusLabels } from './library-status';
import styles from './LibraryPage.module.css';
import tagStyles from './Tags.module.css';

export function LibraryEntryCard({ entry, onSelect }: { entry: LibraryEntry; onSelect(): void }) {
  const { preferences } = usePreferences();
  const [failed, setFailed] = useState(false);
  const { item } = entry;
  const { icon: Icon, singular } = mediaPresentation[item.mediaType];
  return <article className={styles.libraryCard}>
    <div className={styles.cover}>{item.posterUrl && !failed ? <img src={item.posterUrl} alt="" loading="lazy" onError={() => setFailed(true)} /> : <div className={styles.noCover}><Icon size={32} aria-hidden="true" /></div>}</div>
    <div className={styles.cardContent}>
      <div className={styles.cardMeta}><span>{singular} · {item.releaseDate?.slice(0, 4) ?? 'Undated'}</span>{preferences.ratings && item.rating !== null && <span className={styles.rating}><Star size={12} aria-hidden="true" />{item.rating.toFixed(1)}</span>}</div>
      <h3><button type="button" className={styles.cardLink} aria-label={item.title + ' — view details'} aria-haspopup="dialog" onClick={onSelect}>{item.title}</button></h3>
      <span className={styles.provider}>{entry.providerName}</span>
      {preferences.descriptions && <p className={styles.description}>{item.overview || 'No description available.'}</p>}
      <div className={styles.entryStatus}><span data-status={entry.status} />{statusLabels[entry.status]}</div>
      {preferences.tags && entry.tags.length > 0 && <div className={tagStyles.badges} aria-label={'Tags for ' + item.title}>{entry.tags.map((tag) => <span key={tag.id}>{tag.name}</span>)}</div>}
    </div>
  </article>;
}
