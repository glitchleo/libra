import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Search } from 'lucide-react';
import type { CatalogItem, CatalogSearchRequest, CatalogSearchResponse } from '@libra/shared/search';
import { searchCatalog } from './search.api';
import { ResultCard } from './ResultCard';
import { mediaPresentation } from './media-types';
import styles from './SearchPage.module.css';
import { useLibrary } from '../library/LibraryContext';

interface Props {
  request: CatalogSearchRequest;
  providerName: string;
  grouped: boolean;
  onPage(page: number): void;
  onConnected(provider: string): void;
  onSelect(item: CatalogItem): void;
}

export function SearchResults({ request, providerName, grouped, onPage, onConnected, onSelect }: Props) {
  const library = useLibrary();
  const [data, setData] = useState<CatalogSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const label = providerName + ' · ' + mediaPresentation[request.mediaType].plural;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setLoading(true);
    searchCatalog(request, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      onConnected(request.provider);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Search failed. Please try again.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [request, retry, onConnected]);

  return (
    <section className={styles.resultGroup} aria-label={label} aria-busy={loading}>
      <div className={styles.resultsHeader}>
        <h2>{grouped ? label : 'Search results'}</h2>
        <span aria-live="polite">{loading ? 'Searching ' + providerName + '…' : data ? data.totalResults.toLocaleString() + ' ' + mediaPresentation[request.mediaType].plural.toLowerCase() + ' found' : providerName}</span>
      </div>
      {loading && <div className={styles.grid} aria-label="Loading search results">
        {Array.from({ length: grouped ? 4 : 8 }, (_, index) => <div className={styles.skeletonCard} key={index}><div /><span /><span /></div>)}
      </div>}
      {!loading && error && <div className={styles.emptyState} role="alert">
        <div className={styles.emptyIcon}><AlertCircle size={28} /></div>
        <h3>We couldn’t complete that search</h3><p>{error}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => setRetry((value) => value + 1)}>Try again <ArrowRight size={14} /></button>
      </div>}
      {!loading && !error && data && data.results.length > 0 && <>
        <p className={styles.resultContext}>Results for <strong>“{request.query}”</strong>{request.year ? ' · ' + request.year : ''}<span>{label}</span></p>
        <div className={styles.grid}>{data.results.map((item) => <ResultCard key={item.provider + ':' + item.mediaType + ':' + item.sourceId} item={item} providerName={providerName} onSelect={onSelect} saved={Boolean(library.find(item))} />)}</div>
      </>}
      {!loading && !error && data && data.results.length === 0 && <div className={styles.emptyState}>
        <div className={styles.emptyIcon}><Search size={28} /></div>
        <h3>No matches this time</h3><p>No {mediaPresentation[request.mediaType].plural.toLowerCase()} found for “{request.query}” on {providerName}. Try another title or clear a filter.</p>
        <Link to="/entry" state={{ manualTitle: request.query, manualMediaType: request.mediaType }} className={styles.secondaryButton}>Add this title manually<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>}
      {!loading && !error && data && data.totalPages > 1 && <nav className={styles.pagination} aria-label={grouped ? label + ' pages' : 'Search result pages'}>
        <button type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}><ArrowLeft size={15} />Previous</button>
        <span>Page <strong>{data.page}</strong> of {data.totalPages.toLocaleString()}</span>
        <button type="button" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}>Next<ArrowRight size={15} /></button>
      </nav>}
    </section>
  );
}
