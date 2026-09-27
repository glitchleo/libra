import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, CalendarDays, Star, X } from 'lucide-react';
import type { CatalogItem } from '@libra/shared/search';
import type { MediaDetails } from '@libra/shared/manual-entry';
import { commonDetailFields, mediaDetailFields } from '@libra/shared/manual-entry';
import { mediaPresentation } from '../search/media-types';
import styles from './EntryPreview.module.css';
import { EntryLibraryControls } from './EntryLibraryControls';
import { EntryTags } from './EntryTags';

interface Props {
  item: CatalogItem;
  providerName: string;
  closeLabel?: string;
  entryId?: string;
  details?: MediaDetails;
  onClose(): void;
}

function displayDate(value: string | null): string {
  if (!value) return 'Unknown';
  // Open Library gives a publication year, not a specific day.
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value
    : new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

export function EntryPreview({ item, providerName, entryId, details, closeLabel = 'Back to results', onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerStartedOutside = useRef(false);
  const titleId = useId();
  const [imageFailed, setImageFailed] = useState(false);
  const { icon: TypeIcon, singular } = mediaPresentation[item.mediaType];
  const isBook = ['book', 'manga', 'manhwa', 'audiobook'].includes(item.mediaType);
  const authorOverview = item.provider === 'openlibrary' && item.mediaType === 'book';
  const manual = item.provider === 'manual';
  const detailFields = [...mediaDetailFields[item.mediaType], ...commonDetailFields].filter((field) => details?.[field.key] !== undefined && details[field.key] !== '');
  const releaseLabel = isBook ? 'First published' : ['tv', 'anime'].includes(item.mediaType) ? 'First aired' : 'Released';

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    // Native modal dialogs make the background inert and contain keyboard focus.
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('nav a[aria-current="page"]')?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled])');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        pointerStartedOutside.current = event.target === event.currentTarget &&
          (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
      }}
      onClick={(event) => {
        // A click outside the dialog's box is a backdrop click. Empty padding
        // inside the dialog should not dismiss it, nor should dragging text out.
        if (!pointerStartedOutside.current || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <header className={styles.toolbar}>
        <button type="button" className={styles.backButton} onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />{closeLabel}</button>
        <span className={styles.toolbarLabel}>ENTRY DETAILS</span>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close entry details"><X size={19} aria-hidden="true" /></button>
      </header>

      <article className={styles.entry}>
        <aside className={styles.coverColumn} aria-label="Cover">
          <div className={styles.cover}>
            {item.posterUrl && !imageFailed
              ? <img src={item.posterUrl} alt={item.title + ' cover'} onError={() => setImageFailed(true)} />
              : <div className={styles.noCover}><TypeIcon size={50} strokeWidth={1} aria-hidden="true" /><span>No cover available</span></div>}
          </div>
          <span className={styles.coverCaption}>{manual ? 'ADDED BY YOU' : 'FROM ' + providerName.toUpperCase()}</span>
          <EntryLibraryControls item={item} entryId={entryId} />
        </aside>

        <div className={styles.content}>
          <div className={styles.eyebrow}><span><TypeIcon size={13} aria-hidden="true" />{singular}</span><span>{providerName}</span></div>
          <h2 id={titleId}>{item.title}</h2>
          {item.originalTitle && item.originalTitle !== item.title && <p className={styles.originalTitle}><span>Original title</span>{item.originalTitle}</p>}

          <dl className={styles.facts}>
            <div><dt><CalendarDays size={13} aria-hidden="true" />{releaseLabel}</dt><dd>{displayDate(item.releaseDate)}</dd></div>
            {!manual && <div><dt><Star size={13} aria-hidden="true" />Community rating</dt><dd>{item.rating === null ? 'Not rated yet' : <><strong>{item.rating.toFixed(1)}</strong><span> / 10</span></>}</dd>
              {item.voteCount > 0 && <dd className={styles.voteCount}>{item.voteCount.toLocaleString()} {item.voteCount === 1 ? 'rating' : 'ratings'}</dd>}
            </div>}
            {detailFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{details![field.key]}</dd></div>)}
          </dl>

          <section className={styles.overview} aria-label={authorOverview ? 'Authors' : 'Overview'}>
            <h3>{authorOverview ? 'Authors' : 'Overview'}</h3>
            <p>{item.overview || (authorOverview ? 'Author information is not available for this book.' : 'No description available for this title.')}</p>
          </section>

          <EntryTags item={item} />

          <footer className={styles.source}>
            <div><span>{manual ? 'Entry source' : 'Catalog source'}</span><strong>{manual ? 'Added by you' : providerName}</strong></div>
            {item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer">{manual ? 'Visit website' : 'View on ' + providerName}<ArrowUpRight size={15} aria-hidden="true" /><span className={styles.srOnly}> (opens in a new tab)</span></a>}
          </footer>
        </div>
      </article>
    </dialog>, document.body,
  );
}
