// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { CatalogProviderInfo, CatalogSearchResponse } from '@libra/shared/search';
import { App } from '../../app/App';
import { getProviders, searchCatalog } from './search.api';
import { getLibraryIndex } from '../library/library.api';

vi.mock('./search.api', () => ({ getProviders: vi.fn(), searchCatalog: vi.fn() }));
vi.mock('../library/library.api', () => ({ getLibraryIndex: vi.fn() }));

beforeAll(() => {
  // jsdom lacks the native dialog API. Real focus containment and Escape are
  // verified in the browser; this shim exposes the modal to DOM assertions.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

const tmdb: CatalogProviderInfo = {
  id: 'tmdb', name: 'TMDB', description: 'The Movie Database', website: 'https://www.themoviedb.org',
  configured: true, mediaTypes: ['movie', 'tv'], filters: { year: true, language: true, includeAdult: true },
};
const result: CatalogSearchResponse = {
  provider: 'tmdb', query: 'Dune', mediaType: 'movie', page: 1, totalPages: 2, totalResults: 21,
  results: [{
    provider: 'tmdb', sourceId: '438631', title: 'Dune', originalTitle: 'Dune', mediaType: 'movie',
    overview: 'A science-fiction story.', releaseDate: '2021-09-15', posterUrl: null,
    rating: 7.8, voteCount: 100, externalUrl: 'https://www.themoviedb.org/movie/438631',
  }],
};

function renderApp() { return render(<MemoryRouter initialEntries={['/search']}><App /></MemoryRouter>); }
async function ready() { await waitFor(() => expect((screen.getByLabelText('Data provider') as HTMLSelectElement).value).toBe('tmdb')); }
async function submitDune(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('What are you looking for?'), 'Dune');
  await user.click(screen.getByRole('button', { name: 'Search' }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getLibraryIndex).mockResolvedValue({ entries: [], tags: [] });
  vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb] });
  vi.mocked(searchCatalog).mockResolvedValue(result);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const tenrai: CatalogProviderInfo = {
  id: 'tenrai', name: 'Tenrai', description: 'Anime & manga from MyAnimeList',
  website: 'https://tenrai.org', configured: true, requiresCredentials: false,
  mediaTypes: ['anime', 'manga'], filters: { year: false, language: false, includeAdult: true },
};

const igdb: CatalogProviderInfo = {
  id: 'igdb', name: 'IGDB', description: 'Video games from the Internet Game Database',
  website: 'https://www.igdb.com', configured: true, requiresCredentials: true,
  mediaTypes: ['game'], filters: { year: true, language: false, includeAdult: false },
};

const openlibrary: CatalogProviderInfo = {
  id: 'openlibrary', name: 'Open Library', description: 'Books from the Internet Archive’s open catalog',
  website: 'https://openlibrary.org', configured: true, requiresCredentials: false,
  mediaTypes: ['book'], filters: { year: true, language: false, includeAdult: false },
};

function catalogResult(request: Parameters<typeof searchCatalog>[0]): CatalogSearchResponse {
  return {
    ...result, ...request,
    results: [{
      ...result.results[0], provider: request.provider, mediaType: request.mediaType,
      title: request.provider + ' ' + request.mediaType + ' title',
      externalUrl: request.provider === 'igdb' ? 'https://www.igdb.com/games/elden-ring'
        : request.provider === 'openlibrary' ? 'https://openlibrary.org/works/OL893414W'
        : request.provider === 'tenrai' ? 'https://myanimelist.net/' + request.mediaType + '/20' : result.results[0].externalUrl,
    }],
  };
}

describe('Open Library book search', () => {
  beforeEach(() => {
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, tenrai, igdb, openlibrary] });
    vi.mocked(searchCatalog).mockImplementation(async (request) => catalogResult(request));
  });

  it('searches books without a key, displays authors/year, and preserves the year filter on pagination', async () => {
    const user = userEvent.setup();
    vi.mocked(searchCatalog).mockImplementation(async (request) => {
      const response = catalogResult(request);
      response.results[0].overview = 'By Frank Herbert';
      response.results[0].releaseDate = '1965';
      return response;
    });
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'openlibrary');
    expect(screen.getByText('No key needed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Books' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'The Hobbit' })).toBeTruthy();
    expect(screen.queryByLabelText('Result language')).toBeNull();
    expect(screen.queryByLabelText('Include adult')).toBeNull();
    await user.type(screen.getByLabelText('First published year'), '1965');
    await submitDune(user);
    expect(await screen.findByRole('heading', { name: 'openlibrary book title' })).toBeTruthy();
    expect(screen.getByText('By Frank Herbert')).toBeTruthy();
    expect(screen.getByText('1965')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'openlibrary book title — view details' }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(vi.mocked(searchCatalog).mock.calls[0][0]).toEqual({ provider: 'openlibrary', mediaType: 'book', query: 'Dune', page: 1, year: 1965 });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0]).toMatchObject({ provider: 'openlibrary', page: 2, year: 1965 }));
  });

  it('includes books in combined searches and routes Books only to Open Library', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'all');
    await submitDune(user);
    expect(await screen.findByRole('heading', { name: 'openlibrary book title' })).toBeTruthy();
    expect(vi.mocked(searchCatalog).mock.calls.map(([request]) => request.provider + ':' + request.mediaType))
      .toEqual(['tmdb:movie', 'tmdb:tv', 'tenrai:anime', 'tenrai:manga', 'igdb:game', 'openlibrary:book']);
    await user.click(screen.getByRole('button', { name: 'Books' }));
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledTimes(7));
    expect(vi.mocked(searchCatalog).mock.calls[6][0]).toEqual({ provider: 'openlibrary', mediaType: 'book', query: 'Dune', page: 1 });
    expect(screen.getByLabelText('First published year')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'igdb game title' })).toBeNull();
  });
});

describe('IGDB game search', () => {
  beforeEach(() => {
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, tenrai, igdb] });
    vi.mocked(searchCatalog).mockImplementation(async (request) => catalogResult(request));
  });

  it('selects IGDB, offers game suggestions, and searches and paginates with supported filters', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'igdb');
    expect(screen.getByRole('button', { name: 'Games' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Result language')).toBeNull();
    expect(screen.queryByLabelText('Include adult')).toBeNull();
    await user.type(screen.getByLabelText('Release year'), '2022');
    await user.click(screen.getByRole('button', { name: 'Elden Ring' }));
    expect(await screen.findByRole('heading', { name: 'igdb game title' })).toBeTruthy();
    expect(vi.mocked(searchCatalog).mock.calls[0][0]).toEqual({ provider: 'igdb', mediaType: 'game', query: 'Elden Ring', page: 1, year: 2022 });
    expect(screen.getByRole('button', { name: 'igdb game title — view details' }).getAttribute('aria-haspopup')).toBe('dialog');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0]).toMatchObject({ provider: 'igdb', mediaType: 'game', page: 2, year: 2022 }));
  });

  it('includes games in all providers and routes Games only to IGDB', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'all');
    expect(screen.queryByLabelText('Release year')).toBeNull();
    expect(screen.queryByLabelText('Result language')).toBeNull();
    expect(screen.queryByLabelText('Include adult')).toBeNull();
    await submitDune(user);
    expect(await screen.findByRole('heading', { name: 'igdb game title' })).toBeTruthy();
    expect(vi.mocked(searchCatalog).mock.calls.map(([request]) => request.provider + ':' + request.mediaType))
      .toEqual(['tmdb:movie', 'tmdb:tv', 'tenrai:anime', 'tenrai:manga', 'igdb:game']);
    for (const [request] of vi.mocked(searchCatalog).mock.calls) {
      expect(request).not.toHaveProperty('language');
      expect(request).not.toHaveProperty('includeAdult');
    }
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledTimes(6));
    expect(vi.mocked(searchCatalog).mock.calls[5][0]).toEqual({ provider: 'igdb', mediaType: 'game', query: 'Dune', page: 1 });
    expect(screen.queryByRole('heading', { name: 'tmdb movie title' })).toBeNull();
  });

  it('keeps other catalogs usable when IGDB credentials are missing', async () => {
    const user = userEvent.setup();
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, tenrai, {
      ...igdb, configured: false, setupHint: 'Add IGDB_CLIENT_ID and IGDB_ACCESS_TOKEN to server/.env, then restart the server.',
    }] });
    vi.mocked(searchCatalog).mockImplementation(async (request) => {
      if (request.provider === 'igdb') throw new Error('IGDB is not connected yet.');
      return catalogResult(request);
    });
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'all');
    expect(screen.getByText(/Add IGDB_CLIENT_ID and IGDB_ACCESS_TOKEN/)).toBeTruthy();
    await submitDune(user);
    expect(await screen.findByRole('heading', { name: 'tenrai anime title' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'tmdb movie title' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('IGDB is not connected yet.');
  });
});

describe('Tenrai and combined search', () => {
  beforeEach(() => {
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, tenrai] });
    vi.mocked(searchCatalog).mockImplementation(async (request) => catalogResult(request));
  });

  it('searches Tenrai anime or manga with no TMDB-only filters', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'tenrai');
    expect(screen.getByText('No key needed')).toBeTruthy();
    expect(screen.queryByLabelText('Release year')).toBeNull();
    expect(screen.queryByLabelText('Result language')).toBeNull();
    await user.type(screen.getByLabelText('What are you looking for?'), 'Naruto{Enter}');
    expect(await screen.findByRole('heading', { name: 'tenrai anime title' })).toBeTruthy();
    expect(vi.mocked(searchCatalog).mock.calls[0][0]).toEqual({ provider: 'tenrai', mediaType: 'anime', query: 'Naruto', page: 1, includeAdult: false });
    await user.click(screen.getByRole('button', { name: 'Manga' }));
    expect(await screen.findByRole('heading', { name: 'tenrai manga title' })).toBeTruthy();
    expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0].mediaType).toBe('manga');
    expect(screen.getByRole('button', { name: 'tenrai manga title — view details' }).getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('searches both catalogs, isolates failures, and only retries or paginates the selected group', async () => {
    const user = userEvent.setup();
    let tmdbFails = true;
    vi.mocked(searchCatalog).mockImplementation(async (request) => {
      if (request.provider === 'tmdb' && request.mediaType === 'movie' && tmdbFails) throw new Error('TMDB unavailable.');
      return catalogResult(request);
    });
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'all');
    expect(screen.getByRole('button', { name: 'All types' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Result language')).toBeNull();
    await submitDune(user);
    expect(await screen.findByRole('heading', { name: 'tenrai anime title' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'tenrai manga title' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'tmdb tv title' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('TMDB unavailable.');
    expect(vi.mocked(searchCatalog).mock.calls.map(([request]) => request.provider + ':' + request.mediaType)).toEqual(['tmdb:movie', 'tmdb:tv', 'tenrai:anime', 'tenrai:manga']);

    const animePages = screen.getByRole('navigation', { name: 'Tenrai · Anime pages' });
    await user.click(within(animePages).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledTimes(5));
    expect(vi.mocked(searchCatalog).mock.calls[4][0]).toMatchObject({ provider: 'tenrai', mediaType: 'anime', page: 2 });
    expect(screen.getByRole('heading', { name: 'tenrai manga title' })).toBeTruthy();

    tmdbFails = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'tmdb movie title' })).toBeTruthy();
    expect(searchCatalog).toHaveBeenCalledTimes(6);
    expect(vi.mocked(searchCatalog).mock.calls[5][0]).toMatchObject({ provider: 'tmdb', mediaType: 'movie', page: 1 });
    expect(within(screen.getByRole('navigation', { name: 'Tenrai · Anime pages' })).getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);
  });

  it('routes a specific media type only to compatible catalogs and never leaks hidden filters', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'all');
    await user.click(screen.getByRole('button', { name: 'Movies' }));
    await user.type(screen.getByLabelText('Release year'), '2021');
    await user.selectOptions(screen.getByLabelText('Result language'), 'sq-AL');
    await submitDune(user);
    await screen.findByRole('heading', { name: 'tmdb movie title' });
    expect(searchCatalog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchCatalog).mock.calls[0][0]).toMatchObject({ provider: 'tmdb', year: 2021, language: 'sq-AL' });
    await user.click(screen.getByRole('button', { name: 'All types' }));
    await screen.findByRole('heading', { name: 'tenrai anime title' });
    expect(searchCatalog).toHaveBeenCalledTimes(5);
    for (const [request] of vi.mocked(searchCatalog).mock.calls.slice(1)) {
      expect(request).not.toHaveProperty('year');
      expect(request).not.toHaveProperty('language');
    }
  });

  it('resets all group pages for a new query', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'all');
    await submitDune(user);
    await screen.findByRole('heading', { name: 'tenrai anime title' });
    await user.click(within(screen.getByRole('navigation', { name: 'Tenrai · Anime pages' })).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledTimes(5));
    await user.clear(screen.getByLabelText('What are you looking for?'));
    await user.type(screen.getByLabelText('What are you looking for?'), 'Naruto{Enter}');
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledTimes(9));
    for (const [request] of vi.mocked(searchCatalog).mock.calls.slice(5)) {
      expect(request.query).toBe('Naruto');
      expect(request.page).toBe(1);
    }
  });

  it('can search both anime and manga from Tenrai alone', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'tenrai');
    await user.click(screen.getByRole('button', { name: 'All types' }));
    await submitDune(user);
    await screen.findByRole('heading', { name: 'tenrai manga title' });
    expect(vi.mocked(searchCatalog).mock.calls.map(([request]) => request.provider + ':' + request.mediaType)).toEqual(['tenrai:anime', 'tenrai:manga']);
  });
});

describe('external search page', () => {
  it('searches on Enter, renders real response fields, and paginates', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.type(screen.getByLabelText('What are you looking for?'), 'Dune{Enter}');
    expect(await screen.findByRole('heading', { name: 'Dune' })).toBeTruthy();
    expect(screen.getByText('2021')).toBeTruthy();
    expect(screen.getByText('7.8')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dune — view details' }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(vi.mocked(searchCatalog).mock.calls[0][0]).toMatchObject({ query: 'Dune', provider: 'tmdb', mediaType: 'movie', page: 1 });
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(searchCatalog).mockResolvedValue({ ...result, page: 2 });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0].page).toBe(2));
    await screen.findByRole('heading', { name: 'Dune' });
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits TV, year, language, and adult filters and resets them', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.click(screen.getByRole('button', { name: 'TV series' }));
    await user.type(screen.getByLabelText('First aired year'), '2021');
    await user.selectOptions(screen.getByLabelText('Result language'), 'sq-AL');
    await user.click(screen.getByLabelText('Include adult'));
    await submitDune(user);
    await screen.findByRole('heading', { name: 'Dune' });
    expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0]).toMatchObject({ mediaType: 'tv', year: 2021, language: 'sq-AL', includeAdult: true, page: 1 });
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0]).toEqual({ query: 'Dune', provider: 'tmdb', mediaType: 'movie', language: 'en-US', includeAdult: false, page: 1 }));
  });

  it('shows missing credential guidance, request failures, and retry recovery', async () => {
    const user = userEvent.setup();
    vi.mocked(getProviders).mockResolvedValue({ providers: [{ ...tmdb, configured: false, setupHint: 'Add your token to server/.env.' }] });
    vi.mocked(searchCatalog).mockRejectedValueOnce(new Error('TMDB rejected the credentials.'));
    renderApp(); await ready();
    expect(screen.getByText('Add your token to server/.env.')).toBeTruthy();
    await submitDune(user);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('TMDB rejected the credentials.'));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Dune' })).toBeTruthy();
    expect(screen.queryByText('Add your token to server/.env.')).toBeNull();
  });

  it('offers a genuine empty result state without sample results', async () => {
    const user = userEvent.setup();
    vi.mocked(searchCatalog).mockResolvedValue({ ...result, results: [], totalPages: 0, totalResults: 0 });
    renderApp(); await ready(); await submitDune(user);
    expect(await screen.findByRole('heading', { name: 'No matches this time' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /view details/ })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Search result pages' })).toBeNull();
  });

  it('populates the provider selector from the API and uses provider capabilities', async () => {
    const user = userEvent.setup();
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, {
      id: 'books', name: 'Book Catalog', description: 'Test catalog', website: 'https://example.com',
      configured: true, mediaTypes: ['book'], filters: { year: false, language: false, includeAdult: false },
    }] });
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'books');
    expect(screen.getByRole('button', { name: 'Books' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Release year')).toBeNull();
    expect(screen.queryByLabelText('Result language')).toBeNull();
    expect(screen.queryByLabelText('Include adult')).toBeNull();
    await submitDune(user);
    await waitFor(() => expect(vi.mocked(searchCatalog).mock.calls.at(-1)?.[0]).toEqual({ provider: 'books', query: 'Dune', mediaType: 'book', page: 1 }));
  });

  it('ignores a late response from an aborted older request', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: CatalogSearchResponse) => void;
    vi.mocked(searchCatalog).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    renderApp(); await ready(); await submitDune(user);
    expect(screen.getByLabelText('Loading search results')).toBeTruthy();
    const firstSignal = vi.mocked(searchCatalog).mock.calls[0][1];
    vi.mocked(searchCatalog).mockResolvedValue({ ...result, mediaType: 'tv', results: [{ ...result.results[0], title: 'New TV result', mediaType: 'tv' }] });
    await user.click(screen.getByRole('button', { name: 'TV series' }));
    expect(await screen.findByRole('heading', { name: 'New TV result' })).toBeTruthy();
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => { resolveFirst(result); });
    expect(screen.queryByRole('heading', { name: 'Dune' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'New TV result' })).toBeTruthy();
  });

  it('recovers when the provider list initially fails to load', async () => {
    const user = userEvent.setup();
    vi.mocked(getProviders).mockRejectedValueOnce(new Error('Cannot reach Libra.'));
    renderApp();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Cannot reach Libra.'));
    await user.click(screen.getByRole('button', { name: 'Retry connection' }));
    await ready();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens settings and returns to search', async () => {
    const user = userEvent.setup();
    renderApp(); await ready();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Library backups' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Search' }));
    expect(await screen.findByRole('heading', { name: /^Find your next/ })).toBeTruthy();
  });

  it('renders a fallback when a poster image fails', async () => {
    const user = userEvent.setup();
    vi.mocked(searchCatalog).mockResolvedValue({ ...result, results: [{ ...result.results[0], posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg' }] });
    renderApp(); await ready(); await submitDune(user);
    await screen.findByRole('heading', { name: 'Dune' });
    const card = screen.getByRole('button', { name: 'Dune — view details' }).closest('article')!;
    fireEvent.error(card.querySelector('img')!);
    expect(screen.getByText('No cover available')).toBeTruthy();
  });
});

describe('entry previews on the search screen', () => {
  it.each([
    [tmdb, 'movie', 'Movies'], [tmdb, 'tv', 'TV series'], [igdb, 'game', 'Games'],
    [openlibrary, 'book', 'Books'], [tenrai, 'anime', 'Anime'], [tenrai, 'manga', 'Manga'],
  ] as const)('opens %s %s details without navigating or searching again', async (provider, mediaType, typeLabel) => {
    const user = userEvent.setup();
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, tenrai, igdb, openlibrary] });
    vi.mocked(searchCatalog).mockImplementation(async (request) => catalogResult(request));
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), provider.id);
    await user.click(screen.getByRole('button', { name: typeLabel }));
    await submitDune(user);
    const title = provider.id + ' ' + mediaType + ' title';
    const card = await screen.findByRole('button', { name: title + ' — view details' });
    await user.click(card);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(within(dialog).getByRole('heading', { name: title })).toBeTruthy();
    expect(within(dialog).getByText('A science-fiction story.')).toBeTruthy();
    expect(within(dialog).getByText('September 15, 2021')).toBeTruthy();
    expect(within(dialog).getByText('7.8')).toBeTruthy();
    expect(within(dialog).getByText('100 ratings')).toBeTruthy();
    const source = within(dialog).getByRole('link', { name: 'View on ' + provider.name + ' (opens in a new tab)' });
    expect(source.getAttribute('href')).toBe(catalogResult({ provider: provider.id, mediaType, query: 'Dune', page: 1 }).results[0].externalUrl);
    expect(source.getAttribute('target')).toBe('_blank');
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(source);
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Back to results' }));
    expect(screen.getByRole('link', { name: 'Search' }).getAttribute('aria-current')).toBe('page');
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(within(dialog).getByRole('button', { name: 'Back to results' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(card);
    expect(document.body.style.overflow).toBe('');
    expect(searchCatalog).toHaveBeenCalledTimes(1);
  });

  it('preserves filters, query, and the current results page when closing or pressing Escape', async () => {
    const user = userEvent.setup();
    vi.mocked(searchCatalog).mockImplementation(async (request) => ({ ...result, ...request }));
    renderApp(); await ready();
    await user.type(screen.getByLabelText('Release year'), '2021');
    await submitDune(user);
    await screen.findByRole('button', { name: 'Dune — view details' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const card = await screen.findByRole('button', { name: 'Dune — view details' });
    await user.click(card);
    await user.click(screen.getByRole('button', { name: 'Close entry details' }));
    expect((screen.getByLabelText('What are you looking for?') as HTMLInputElement).value).toBe('Dune');
    expect((screen.getByLabelText('Release year') as HTMLInputElement).value).toBe('2021');
    expect(screen.getByRole('navigation', { name: 'Search result pages' }).textContent).toContain('Page 2 of 2');
    // The restored button can immediately be opened using the keyboard.
    await user.keyboard('{Enter}');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true, bubbles: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(card);
    expect(searchCatalog).toHaveBeenCalledTimes(2);
  });

  it('shows book authors and year-only publication dates, and handles a broken cover', async () => {
    const user = userEvent.setup();
    vi.mocked(getProviders).mockResolvedValue({ providers: [tmdb, openlibrary] });
    vi.mocked(searchCatalog).mockResolvedValue({ ...result, results: [{ ...result.results[0],
      provider: 'openlibrary', mediaType: 'book', originalTitle: 'Dune: Original title',
      overview: 'By Frank Herbert', releaseDate: '1965', posterUrl: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
    }] });
    renderApp(); await ready();
    await user.selectOptions(screen.getByLabelText('Data provider'), 'openlibrary');
    await submitDune(user);
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'Authors' })).toBeTruthy();
    expect(dialog.getByText('By Frank Herbert')).toBeTruthy();
    expect(dialog.getByText('1965')).toBeTruthy();
    expect(dialog.getByText('Dune: Original title')).toBeTruthy();
    fireEvent.error(dialog.getByRole('img', { name: 'Dune cover' }));
    expect(dialog.getByText('No cover available')).toBeTruthy();
    expect(dialog.queryByRole('img')).toBeNull();
  });

  it('handles missing metadata and renders descriptions as text', async () => {
    const user = userEvent.setup();
    vi.mocked(searchCatalog).mockResolvedValue({ ...result, results: [{ ...result.results[0],
      overview: '', releaseDate: null, rating: null, voteCount: 0,
    }, { ...result.results[0], sourceId: '2', title: 'Other movie', overview: '<script>unsafe()</script>\nSecond paragraph.' }] });
    renderApp(); await ready(); await submitDune(user);
    await user.click(await screen.findByRole('button', { name: 'Dune — view details' }));
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Unknown')).toBeTruthy();
    expect(dialog.getByText('Not rated yet')).toBeTruthy();
    expect(dialog.getByText('No description available for this title.')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Close entry details' }));
    await user.click(screen.getByRole('button', { name: 'Other movie — view details' }));
    dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/<script>unsafe/)).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('script')).toBeNull();
  });
});
