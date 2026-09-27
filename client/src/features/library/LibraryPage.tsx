import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Check, Grid2X2, Grid3X3, List, LibraryBig, Plus, Search, SlidersHorizontal, Tag, X } from 'lucide-react';
import type { MediaType } from '@libra/shared/search';
import type { LibraryEntry, LibraryResponse, LibrarySort, LibraryStatus } from '@libra/shared/library';
import { libraryStatuses } from '@libra/shared/library';
import { EntryPreview } from '../entries/EntryPreview';
import { LibraryEntryCard } from './LibraryEntryCard';
import { usePreferences } from '../settings/PreferencesContext';
import { mediaPresentation } from '../search/media-types';
import { useLibrary } from './LibraryContext';
import { getLibrary } from './library.api';
import { statusLabels } from './library-status';
import styles from './LibraryPage.module.css';
import searchStyles from '../search/SearchPage.module.css';
import tagStyles from './Tags.module.css';
import { TagManager } from './TagManager';

const mediaTypes: MediaType[] = ['movie', 'tv', 'anime', 'game', 'book', 'manga', 'manhwa', 'audiobook', 'other'];

export function LibraryPage() {
  const { revision, tags, ready, error: libraryError, refresh } = useLibrary();
  const { preferences, update: updatePreferences } = usePreferences();
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [query, setQuery] = useState('');
  const [mediaType, setMediaType] = useState<MediaType | ''>('');
  const [status, setStatus] = useState<LibraryStatus | ''>('');
  const sort = preferences.sort;
  const setSort = (value: LibrarySort) => updatePreferences({ sort: value });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<LibraryEntry | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [managingTags, setManagingTags] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const next = tagIds.filter((id) => tags.some((tag) => tag.id === id));
    if (next.length !== tagIds.length) { setTagIds(next); setPage(1); }
  }, [tags, ready, tagIds]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      getLibrary({ query: query.trim(), mediaType: mediaType || undefined, status: status || undefined, sort, page, ...(tagIds.length ? { tagIds } : {}) }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setData(result); })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load your library.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, mediaType, status, sort, page, tagIds, revision, retry]);

  function clearFilters() { setQuery(''); setMediaType(''); setStatus(''); setTagIds([]); setPage(1); }
  const filtered = Boolean(query || mediaType || status || tagIds.length);

  return <main id="main-content" className={styles.page}>
    <header className={styles.heading}>
      <div><div className={styles.eyebrow}><span />YOUR STORIES, TOGETHER</div><h1>Your library<span>.</span></h1><p>A place for what you love—and what comes next.</p></div>
      <div className={styles.headingActions}><Link to="/search" className={styles.secondaryLink}><Search size={16} aria-hidden="true" />Find titles to add</Link><Link to="/entry" className={styles.primaryLink}><Plus size={17} aria-hidden="true" />Add entry</Link></div>
    </header>

    <div className={styles.stats} aria-label="Library summary">
      <div><LibraryBig size={19} aria-hidden="true" /><span><strong>{data?.summary.total ?? '—'}</strong>Saved titles</span></div>
      <div><BookOpen size={19} aria-hidden="true" /><span><strong>{data ? data.summary.byStatus.in_progress ?? 0 : '—'}</strong>In progress</span></div>
      <div><Check size={19} aria-hidden="true" /><span><strong>{data ? data.summary.byStatus.completed ?? 0 : '—'}</strong>Completed</span></div>
    </div>

    <section className={styles.collection} aria-label="Saved entries">
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input aria-label="Search your library" type="search" placeholder="Search titles, authors, or tags…" value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
        <button type="button" className={styles.mobileFilters} aria-expanded={filtersOpen} aria-controls="library-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} aria-hidden="true" />Filters{Boolean(mediaType || status || tagIds.length) && ' · Active'}</button>
      </div>
      <div id="library-filters" className={`${styles.filtersPanel} ${filtersOpen ? styles.filtersOpen : ''}`}>
      <div className={styles.filterFields}>
        <label className={styles.field}>Status<select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value as LibraryStatus | ''); setPage(1); }}><option value="">All statuses</option>{libraryStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
        <label className={styles.field}>Sort by<select aria-label="Sort library" value={sort} onChange={(event) => { setSort(event.target.value as LibrarySort); setPage(1); }}><option value="added_desc">Recently added</option><option value="title_asc">Title A–Z</option><option value="rating_desc">Catalog rating</option></select></label>
      </div>
      <div className={styles.typeRow} role="group" aria-label="Filter by media type">
        <button type="button" aria-pressed={!mediaType} onClick={() => { setMediaType(''); setPage(1); }}>All titles</button>
        {mediaTypes.map((type) => { const { icon: Icon, plural } = mediaPresentation[type]; return <button key={type} type="button" aria-pressed={mediaType === type} onClick={() => { setMediaType(type); setPage(1); }}><Icon size={14} aria-hidden="true" />{plural}</button>; })}
      </div>

      <section className={tagStyles.section} aria-label="Tag filters">
        <div className={tagStyles.heading}>
          <h2><Tag size={15} aria-hidden="true" />Filter by tags</h2>
          <button type="button" className={tagStyles.button} disabled={!ready} aria-expanded={managingTags} aria-controls="tag-manager" onClick={() => setManagingTags(!managingTags)}>{managingTags ? 'Done managing tags' : 'Manage tags'}</button>
        </div>
        {libraryError && <p className={tagStyles.error} role="alert">{libraryError} <button className={tagStyles.button} type="button" onClick={() => void refresh()}>Reload tags</button></p>}
        {!ready && !libraryError && <p className={tagStyles.hint}>Loading tags…</p>}
        {ready && <>
          <div className={tagStyles.chips} role="group" aria-label="Filter by tags">
            <button type="button" className={tagStyles.chip} aria-pressed={tagIds.length === 0} onClick={() => { setTagIds([]); setPage(1); }}>All tags</button>
            {tags.map((tag) => <button key={tag.id} type="button" className={tagStyles.chip} disabled={tagIds.length >= 50 && !tagIds.includes(tag.id)} aria-pressed={tagIds.includes(tag.id)} onClick={() => { setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id]); setPage(1); }}>{tagIds.includes(tag.id) && <Check size={13} aria-hidden="true" />}{tag.name}</button>)}
          </div>
          {tagIds.length > 0 && <p className={tagStyles.message}>Showing titles with all selected tags.</p>}
          {tags.length === 0 && <p className={tagStyles.message}>Create a tag to start organizing your collection.</p>}
          {managingTags && <TagManager />}
        </>}
      </section>

      </div>

      <div className={styles.resultsLabel}>
        <div><h2>{filtered ? 'Matching titles' : 'Your collection'}</h2><span aria-live="polite">{loading ? 'Loading library…' : error || !data ? '' : `${data.totalResults.toLocaleString()} ${data.totalResults === 1 ? 'title' : 'titles'}`}</span></div>
        <div className={styles.viewOptions} role="group" aria-label="Library display">{([{ value: 'small', label: 'Small covers', icon: Grid3X3 }, { value: 'large', label: 'Large covers', icon: Grid2X2 }, { value: 'list', label: 'List view', icon: List }] as const).map(({ value, label, icon: Icon }) => <button type="button" key={value} title={label} aria-label={label} aria-pressed={preferences.view === value} onClick={() => updatePreferences({ view: value })}><Icon size={18} aria-hidden="true" /></button>)}</div>
      </div>
      {filtered && <button type="button" className={styles.clearFilters} onClick={clearFilters}><X size={14} aria-hidden="true" />Clear filters</button>}
      {error && <div role="alert" className={styles.empty}><h3>We couldn’t load your library</h3><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
      {!error && loading && !data && <div className={searchStyles.grid} aria-label="Loading library">{Array.from({ length: 6 }, (_, index) => <div className={searchStyles.skeletonCard} key={index}><div /><span /><span /></div>)}</div>}
      {!error && data && data.entries.length > 0 && <div className={`${styles.entries} ${styles[preferences.view]}`} aria-label="Library entries" aria-busy={loading}>
        {data.entries.map((entry) => <LibraryEntryCard key={entry.id} entry={entry} onSelect={() => setSelected(entry)} />)}
      </div>}
      {!error && !loading && data?.entries.length === 0 && <div className={styles.empty}>
        <LibraryBig size={34} strokeWidth={1.3} aria-hidden="true" />
        <h3>{data.summary.total === 0 ? 'Make room for your favorites.' : 'No matching titles'}</h3>
        <p>{data.summary.total === 0 ? 'Find a movie, game, book, or series. Open its details and choose Add to library to keep it here.' : 'Try another title or clear a filter to see more of your library.'}</p>
        {data.summary.total === 0 ? <Link to="/search">Discover your first title<ArrowRight size={15} aria-hidden="true" /></Link> : <button type="button" onClick={clearFilters}>Clear filters</button>}
      </div>}
      {!error && data && data.totalPages > 1 && <nav className={searchStyles.pagination} aria-label="Library pages">
        <button type="button" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}><ArrowLeft size={15} aria-hidden="true" />Previous</button>
        <span>Page <strong>{data.page}</strong> of {data.totalPages}</span>
        <button type="button" disabled={loading || data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>Next<ArrowRight size={15} aria-hidden="true" /></button>
      </nav>}
    </section>
    {selected && <EntryPreview key={selected.id} item={selected.item} providerName={selected.providerName} entryId={selected.id} details={selected.details} closeLabel="Back to library" onClose={() => setSelected(null)} />}
  </main>;
}
