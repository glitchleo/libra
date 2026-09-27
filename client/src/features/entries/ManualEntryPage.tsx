import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus } from 'lucide-react';
import type { MediaType } from '@libra/shared/search';
import type { LibraryEntry, LibraryStatus } from '@libra/shared/library';
import { libraryStatuses } from '@libra/shared/library';
import { commonDetailFields, mediaDetailFields } from '@libra/shared/manual-entry';
import type { DetailField, ManualEntryInput, MediaDetails } from '@libra/shared/manual-entry';
import { mediaPresentation } from '../search/media-types';
import { statusLabels } from '../library/library-status';
import { useLibrary } from '../library/LibraryContext';
import { EntryPreview } from './EntryPreview';
import styles from './ManualEntryPage.module.css';
import { DraftTags } from '../library/DraftTags';
import { usePreferences } from '../settings/PreferencesContext';

const types = Object.keys(mediaDetailFields) as MediaType[];
const emptyForm = () => ({ requestId: crypto.randomUUID(), title: '', originalTitle: '', description: '', releaseDate: '', coverUrl: '', websiteUrl: '' });

export function ManualEntryPage() {
  const library = useLibrary();
  const { preferences } = usePreferences();
  const { state: routeState } = useLocation();
  const [form, setForm] = useState(() => ({ ...emptyForm(), title: typeof routeState?.manualTitle === 'string' ? routeState.manualTitle.slice(0, 2000) : '' }));
  const [mediaType, setMediaType] = useState<MediaType>(() => types.includes(routeState?.manualMediaType) ? routeState.manualMediaType : 'movie');
  const [status, setStatus] = useState<LibraryStatus>(preferences.defaultStatus);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<LibraryEntry | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const { icon: MediaIcon, singular } = mediaPresentation[mediaType];
  const dateLabel = ['book', 'manga', 'manhwa', 'audiobook'].includes(mediaType) ? 'Publication date' : ['tv', 'anime'].includes(mediaType) ? 'First aired' : 'Release date';

  function update(key: Exclude<keyof typeof form, 'requestId'>, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || creatingTag) return;
    if (!form.title.trim()) { setError('Enter a title.'); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    submitting.current = true; setBusy(true); setError('');
    const metadata: MediaDetails = {};
    for (const field of [...commonDetailFields, ...mediaDetailFields[mediaType]]) {
      const value = details[field.key]?.trim();
      if (value) metadata[field.key] = field.type === 'number' ? Number(value) : value;
    }
    const input: ManualEntryInput = {
      ...form, title: form.title.trim(), originalTitle: form.originalTitle.trim(), description: form.description.trim(),
      releaseDate: form.releaseDate.trim() || null, coverUrl: form.coverUrl.trim() || null, websiteUrl: form.websiteUrl.trim() || null,
      mediaType, status, details: metadata, tagIds,
    };
    try {
      const entry = await library.createManual(input);
      setSaved(entry);
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this entry. Your details are still here; please try again.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { submitting.current = false; setBusy(false); }
  }

  function detailInput(field: DetailField) {
    const id = 'detail-' + field.key;
    return <label className={styles.field} htmlFor={id} key={field.key}>{field.label}
      <input id={id} type={field.type} value={details[field.key] ?? ''} maxLength={field.type === 'text' ? field.max : undefined}
        min={field.type === 'number' ? field.step ?? 1 : undefined} max={field.type === 'number' ? field.max : undefined} step={field.step}
        onChange={(event) => setDetails((current) => ({ ...current, [field.key]: event.target.value }))} />
    </label>;
  }

  return <main id="main-content" className={styles.page}>
    <Link to="/library" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />Back to library</Link>
    <header className={styles.heading}>
      <div className={styles.eyebrow}>MAKE IT PART OF YOUR COLLECTION</div>
      <h1>Add an entry<span>.</span></h1>
      <p>Some favorites are harder to find. Give yours a place here.</p>
    </header>

    {saved ? <div className={styles.success} ref={successRef} tabIndex={-1}>
      <Check size={32} aria-hidden="true" />
      <h2>{library.find(saved.item) ? 'Added to your library' : 'Removed from your library'}</h2>
      <p><strong>{saved.item.title}</strong>{library.find(saved.item) ? ' is saved with your details.' : ' can be restored by opening View entry.'}</p>
      <div className={styles.actions}>
        <Link to="/library" className={styles.primary}>View library<ArrowRight size={16} aria-hidden="true" /></Link>
        <button type="button" className={styles.secondary} onClick={() => setPreview(true)}>View entry</button>
        <button type="button" className={styles.secondary} onClick={() => { setSaved(null); setForm(emptyForm()); setDetails({}); setTagIds([]); setStatus(preferences.defaultStatus); }}>Add another entry</button>
      </div>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy} className={styles.formBody}>
        <legend className={styles.srOnly}>New entry details</legend>
        <section className={styles.typeSection} aria-labelledby="media-heading">
          <div className={styles.sectionHeading}><h2 id="media-heading">What are you adding?</h2><p>Choose a type to see the relevant details.</p></div>
          <div className={styles.types} role="group" aria-label="Media type">
            {types.map((type) => { const { icon: Icon, singular: name } = mediaPresentation[type]; return <button key={type} type="button" aria-pressed={mediaType === type} onClick={() => setMediaType(type)}><Icon size={19} aria-hidden="true" />{type === 'other' ? 'Other' : name}</button>; })}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="basics-heading">
          <div className={styles.sectionHeading}><h2 id="basics-heading">The essentials</h2><p>Title is required. Everything else can be left blank.</p></div>
          <div className={styles.grid}>
            <label className={styles.wideField} htmlFor="manual-title">Title <span className={styles.required}>(required)</span><input id="manual-title" required maxLength={2000} value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="The title you want to keep" /></label>
            <label className={styles.wideField} htmlFor="manual-description">Description<textarea id="manual-description" rows={5} maxLength={50000} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="What is it about?" /></label>
            <label className={styles.field} htmlFor="manual-original">Original or alternative title<input id="manual-original" maxLength={2000} value={form.originalTitle} onChange={(event) => update('originalTitle', event.target.value)} /></label>
            <label className={styles.field} htmlFor="manual-date">{dateLabel}<input id="manual-date" placeholder="YYYY or YYYY-MM-DD" pattern="[0-9]{4}(-[0-9]{2}-[0-9]{2})?" maxLength={10} title="Enter a year or a date in YYYY-MM-DD format" value={form.releaseDate} onChange={(event) => update('releaseDate', event.target.value)} /></label>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="details-heading">
          <div className={styles.sectionHeading}><h2 id="details-heading"><MediaIcon size={18} aria-hidden="true" />{singular} details</h2><p>Add whatever you know.</p></div>
          <div className={styles.grid}>{mediaDetailFields[mediaType].map(detailInput)}{commonDetailFields.map(detailInput)}</div>
        </section>

        <section className={styles.section} aria-labelledby="finishing-heading">
          <div className={styles.sectionHeading}><h2 id="finishing-heading">Make it yours</h2><p>Add a cover, a reference, and a place in your plans.</p></div>
          <div className={styles.grid}>
            <label className={styles.field} htmlFor="manual-cover">Cover image URL<input id="manual-cover" type="url" pattern="https://.*" placeholder="https://…" maxLength={2048} value={form.coverUrl} onChange={(event) => update('coverUrl', event.target.value)} /><span className={styles.hint}>Optional direct link to an image, starting with https://.</span></label>
            <label className={styles.field} htmlFor="manual-website">Website or reference URL<input id="manual-website" type="url" pattern="https://.*" placeholder="https://…" maxLength={2048} value={form.websiteUrl} onChange={(event) => update('websiteUrl', event.target.value)} /></label>
            <label className={styles.field} htmlFor="manual-status">Library status<select id="manual-status" value={status} onChange={(event) => setStatus(event.target.value as LibraryStatus)}>{libraryStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="new-tags-heading">
          <div className={styles.sectionHeading}><h2 id="new-tags-heading">Organize with tags</h2><p>Choose existing tags or make one of your own.</p></div>
          <DraftTags value={tagIds} onChange={setTagIds} onBusyChange={setCreatingTag} />
        </section>
      </fieldset>
      {error && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}</div>}
      <div className={styles.formFooter}><p>This entry will be saved to your library.</p><button type="submit" className={styles.primary} disabled={busy || creatingTag}>{busy ? <LoaderCircle size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}{busy ? 'Saving entry…' : 'Add to library'}</button></div>
    </form>}
    {preview && saved && <EntryPreview item={saved.item} providerName={saved.providerName} entryId={saved.id} details={saved.details} closeLabel="Back to add entry" onClose={() => setPreview(false)} />}
  </main>;
}
