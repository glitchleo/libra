import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle, ArrowRight, ArrowUpRight, Check, ChevronDown,
  Globe2, Search, SlidersHorizontal, X, Film, BookOpen, Gamepad2,
} from 'lucide-react';
import type { CatalogItem, CatalogProviderInfo, CatalogSearchRequest, MediaType } from '@libra/shared/search';
import { EntryPreview } from '../entries/EntryPreview';
import { getProviders } from './search.api';
import { SearchResults } from './SearchResults';
import { mediaPresentation } from './media-types';
import styles from './SearchPage.module.css';

const languages = [
  ['en-US', 'English'], ['sq-AL', 'Albanian'], ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'], ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['es-ES', 'Spanish'],
];

interface Filters {
  mediaType: MediaType | 'all';
  year: string;
  language: string;
  includeAdult: boolean;
}
const initialFilters: Filters = { mediaType: 'movie', year: '', language: 'en-US', includeAdult: false };

export function SearchPage() {
  const [providers, setProviders] = useState<CatalogProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerError, setProviderError] = useState('');
  const [providerReload, setProviderReload] = useState(0);
  const [providerId, setProviderId] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [requests, setRequests] = useState<CatalogSearchRequest[] | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<CatalogItem | null>(null);
  const selectedProviders = providerId === 'all' ? providers : providers.filter((item) => item.id === providerId);
  const mediaTypes = [...new Set(selectedProviders.flatMap((item) => item.mediaTypes))];
  const targets = selectedProviders.filter((item) => filters.mediaType === 'all' || item.mediaTypes.includes(filters.mediaType));
  const capabilities = {
    year: targets.length > 0 && targets.every((item) => item.filters.year),
    language: targets.length > 0 && targets.every((item) => item.filters.language),
    includeAdult: targets.length > 0 && targets.every((item) => item.filters.includeAdult),
  };
  const onConnected = useCallback((id: string) => {
    setProviders((current) => current.map((item) => item.id === id && !item.configured ? { ...item, configured: true } : item));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setProvidersLoading(true);
    setProviderError('');
    getProviders(controller.signal).then(({ providers: available }) => {
      if (controller.signal.aborted) return;
      setProviders(available);
      setProviderId((current) => (current === 'all' || available.some((item) => item.id === current)) ? current : available[0]?.id ?? '');
      setFilters((current) => {
        const selected = providerId === 'all' ? available : [available.find((item) => item.id === providerId) ?? available[0]].filter(Boolean);
        const types = selected.flatMap((item) => item.mediaTypes);
        return types.length && current.mediaType !== 'all' && !types.includes(current.mediaType)
          ? { ...initialFilters, mediaType: types[0] } : current;
      });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setProviderError(cause instanceof Error ? cause.message : 'Could not load catalogs.');
    }).finally(() => {
      if (!controller.signal.aborted) setProvidersLoading(false);
    });
    return () => controller.abort();
    // A provider refresh preserves the current selection; selection alone does not refetch metadata.
  }, [providerReload]);

  function makeRequests(title: string, nextFilters: Filters = filters): CatalogSearchRequest[] {
    if (!title.trim()) return [];
    const catalogs = selectedProviders.filter((item) => nextFilters.mediaType === 'all' || item.mediaTypes.includes(nextFilters.mediaType));
    return catalogs.flatMap((catalog) => {
      const types = nextFilters.mediaType === 'all' ? catalog.mediaTypes : [nextFilters.mediaType];
      return types.map((mediaType) => ({
        provider: catalog.id, query: title.trim(), mediaType, page: 1,
        ...(catalogs.every((item) => item.filters.year) && nextFilters.year ? { year: Number(nextFilters.year) } : {}),
        ...(catalogs.every((item) => item.filters.language) ? { language: nextFilters.language } : {}),
        ...(catalogs.every((item) => item.filters.includeAdult) ? { includeAdult: nextFilters.includeAdult } : {}),
      }));
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequests(makeRequests(query));
  }

  function changeMediaType(mediaType: MediaType | 'all') {
    const next = { ...filters, mediaType };
    setFilters(next);
    if (requests?.length) setRequests(makeRequests(requests[0].query, next));
  }

  function selectProvider(id: string) {
    const selected = providers.find((item) => item.id === id);
    setProviderId(id);
    setFilters({ ...initialFilters, mediaType: id === 'all' ? 'all' : selected?.mediaTypes[0] ?? 'movie' });
    setRequests(null);
  }

  function resetFilters() {
    const next: Filters = { ...initialFilters, mediaType: providerId === 'all' ? 'all' : selectedProviders[0]?.mediaTypes[0] ?? 'movie' };
    setFilters(next);
    if (requests?.length) setRequests(makeRequests(requests[0].query, next));
  }

  const activeFilters = Boolean((capabilities.year && filters.year) || (capabilities.language && filters.language !== 'en-US') || filters.includeAdult);
  const suggestions = providerId === 'igdb' ? ['Elden Ring', 'Hades', 'Stardew Valley']
    : providerId === 'openlibrary' ? ['Dune', 'The Hobbit', 'Pride and Prejudice']
    : providerId === 'tenrai' ? ['Naruto', 'One Piece', 'Frieren'] : ['Dune', 'Interstellar', 'Spirited Away'];
  const yearLabel = filters.mediaType === 'tv' ? 'First aired year' : filters.mediaType === 'book' ? 'First published year' : 'Release year';

  return (
    <main id="main-content" className={styles.page}>
      <div className={styles.pageHeading}>
        <div><div className={styles.eyebrow}>A WORLD OF STORIES. A SPACE OF YOUR OWN.</div><h1>Find your next<br /><span>obsession.</span></h1><p>Movies, books, games, and everything in between.<br />Discover something worth keeping.</p></div>
        <div className={styles.heroIndex} aria-hidden="true"><div><Film size={30} strokeWidth={1.3} /><span>01 / WATCH</span></div><div><BookOpen size={30} strokeWidth={1.3} /><span>02 / READ</span></div><div><Gamepad2 size={30} strokeWidth={1.3} /><span>03 / PLAY</span></div></div>
      </div>

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="Catalog selection">
          <div className={styles.sourcePicker}>
          <label className={styles.providerLabel} htmlFor="catalog-provider"><Globe2 size={15} aria-hidden="true" />Data provider</label>
          <div className={styles.selectWrap}>
            <select id="catalog-provider" value={providerId} onChange={(event) => selectProvider(event.target.value)} disabled={providersLoading || !providers.length}>
              {!providers.length && <option value="">{providersLoading ? 'Loading catalogs…' : 'No catalogs available'}</option>}
              {providers.length > 1 && <option value="all">All providers ({providers.map((item) => item.name).join(' + ')})</option>}
              {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select><ChevronDown size={15} aria-hidden="true" />
          </div>
          </div>
          <details className={styles.catalogDetails}>
          <summary>About the catalogs<ChevronDown size={14} aria-hidden="true" /></summary>
          <div className={styles.providerCards}>
          {selectedProviders.map((provider) => <div key={provider.id} className={styles.providerCard}>
            <div className={styles.providerCardTop}><span className={styles.providerIcon}><Globe2 size={21} /></span><span className={styles.providerStatus + (provider.configured ? ' ' + styles.connected : '')}>{provider.configured ? <><Check size={11} />{provider.requiresCredentials === false ? 'No key needed' : 'Configured'}</> : 'Setup needed'}</span></div>
            <h2>{provider.name}</h2><p>{provider.description}</p>
            <div className={styles.providerTypes}>{provider.mediaTypes.map((type) => <span key={type}>{mediaPresentation[type].plural}</span>)}</div>
            <a href={provider.website} target="_blank" rel="noreferrer">Visit catalog <ArrowUpRight size={13} /></a>
          </div>)}
          </div>
          </details>
          {providerError && <div role="alert" className={styles.sidebarError}><p>{providerError}</p><button type="button" onClick={() => setProviderReload((value) => value + 1)}>Retry connection</button></div>}
        </aside>

        <section className={styles.searchArea} aria-label="Search external catalogs">
          <form onSubmit={submit} className={styles.searchForm}>
            <label htmlFor="catalog-query" className={styles.searchLabel}>What are you looking for?</label>
            <div className={styles.searchRow}>
              <div className={styles.searchInputWrap}><Search size={20} aria-hidden="true" /><input id="catalog-query" type="search" placeholder="Search for a title…" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} required autoComplete="off" /></div>
              <button className={styles.searchButton} type="submit" disabled={!targets.length || !query.trim()}><Search size={17} /><span>Search</span></button>
            </div>
            <div className={styles.filtersTop}>
              <div className={styles.mediaTypes} role="group" aria-label="Media type">
                {mediaTypes.length > 1 && <button type="button" aria-pressed={filters.mediaType === 'all'} className={filters.mediaType === 'all' ? styles.selectedType : ''} onClick={() => changeMediaType('all')}><Globe2 size={15} />All types</button>}
                {mediaTypes.map((type) => {
                  const { icon: Icon, plural } = mediaPresentation[type];
                  return <button type="button" key={type} aria-pressed={filters.mediaType === type} className={filters.mediaType === type ? styles.selectedType : ''} disabled={!targets.length} onClick={() => changeMediaType(type)}><Icon size={15} />{plural}</button>;
                })}
              </div>
              <span className={styles.providerHint}>{targets.length ? 'Searching ' + targets.map((item) => item.name).join(' + ') : 'Choose a source to begin'}</span>
            </div>
            {targets.length > 0 && <div className={styles.filters}>
              <SlidersHorizontal size={15} className={styles.filterIcon} aria-hidden="true" />
              {capabilities.year && <label className={styles.inlineField}><span>{yearLabel}</span><input aria-label={yearLabel} type="number" placeholder="Any year" min="1000" max="9999" step="1" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} /></label>}
              {capabilities.language && <label className={styles.inlineField}><span>Result language</span><select aria-label="Result language" value={filters.language} onChange={(event) => setFilters({ ...filters, language: event.target.value })}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              {capabilities.includeAdult && <label className={styles.adultFilter}><input type="checkbox" checked={filters.includeAdult} onChange={(event) => setFilters({ ...filters, includeAdult: event.target.checked })} /><span>Include adult</span></label>}
              {activeFilters && <button type="button" className={styles.resetFilters} onClick={resetFilters}><X size={13} />Reset</button>}
            </div>}
          </form>

          {selectedProviders.filter((provider) => !provider.configured).map((provider) => <div key={provider.id} className={styles.setupNotice} role="status">
            <AlertCircle size={18} /><div><strong>Connect {provider.name} to start searching</strong><p>{provider.setupHint ?? 'Configure this catalog on the Libra server, then refresh the connection.'}</p></div>
            <button type="button" onClick={() => setProviderReload((value) => value + 1)} aria-label="Refresh catalog connection"><ArrowRight size={17} /></button>
          </div>)}
          {providerId === 'all' && <p className={styles.sourceNote}>All types searches every selected catalog. A specific type searches only catalogs that support it. Filters shown apply to all active catalogs.</p>}
          {!requests && <div className={styles.resultsHeader}><h2>Your next discovery</h2><span>A title is all it takes</span></div>}
            {!requests && <div className={styles.discovery}><div><span className={styles.emptyEyebrow}>START WITH SOMETHING YOU LOVE</span><h3>Every great collection<br /> starts somewhere.</h3><p>Revisit a favorite or follow your curiosity.</p></div><div className={styles.suggestions}><span>A FEW PLACES TO START</span>{suggestions.map((title, index) => <button type="button" disabled={!targets.length} key={title} onClick={() => { setQuery(title); setRequests(makeRequests(title)); }}><span className={styles.suggestionNumber} aria-hidden="true">0{index + 1}</span>{title}<ArrowUpRight size={17} aria-hidden="true" /></button>)}</div></div>}
          {requests?.map((request, index) => <SearchResults
            key={request.provider + ':' + request.mediaType}
            request={request}
            providerName={providers.find((item) => item.id === request.provider)?.name ?? request.provider}
            grouped={requests.length > 1}
            onConnected={onConnected}
            onSelect={setSelectedEntry}
            onPage={(page) => setRequests((current) => current?.map((item, itemIndex) => itemIndex === index ? { ...item, page } : item) ?? null)}
          />)}

        </section>
      </div>
      {selectedEntry && <EntryPreview
        key={selectedEntry.provider + ':' + selectedEntry.mediaType + ':' + selectedEntry.sourceId}
        item={selectedEntry}
        providerName={providers.find((provider) => provider.id === selectedEntry.provider)?.name ?? selectedEntry.provider}
        onClose={() => setSelectedEntry(null)}
      />}
    </main>
  );
}
