import { useState } from 'react';
import { Check, Expand, Star } from 'lucide-react';
import type { CatalogItem } from '@libra/shared/search';
import styles from './SearchPage.module.css';
import { mediaPresentation } from './media-types';

export function ResultCard({ item, providerName, onSelect, saved = false }: { item: CatalogItem; providerName: string; onSelect(item: CatalogItem): void; saved?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const { icon: TypeIcon, singular } = mediaPresentation[item.mediaType];
  return (
    <article className={styles.card}>
      <div className={styles.poster}>
        {item.posterUrl && !imageFailed
          ? <img src={item.posterUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} />
          : <div className={styles.noPoster}><TypeIcon size={34} strokeWidth={1} aria-hidden="true" /><span>No cover available</span></div>}
        <span className={styles.posterType}><TypeIcon size={12} aria-hidden="true" />{singular}</span>
        {item.rating !== null && <span className={styles.rating}><Star size={11} fill="currentColor" aria-hidden="true" />{item.rating.toFixed(1)}</span>}
        <span className={styles.cardOpen}><Expand size={18} aria-hidden="true" /></span>
        {saved && <span className={styles.savedBadge}><Check size={11} aria-hidden="true" />In library</span>}
      </div>
      <h3><button type="button" className={styles.cardLink} onClick={() => onSelect(item)} aria-label={item.title + ' — view details'} aria-haspopup="dialog">{item.title}</button></h3>
      <div className={styles.cardMeta}><span>{item.releaseDate?.slice(0, 4) ?? 'Date unknown'}</span><span>{providerName.toUpperCase()}</span></div>
      <p className={styles.overview}>{item.overview || 'No description available.'}</p>
    </article>
  );
}
