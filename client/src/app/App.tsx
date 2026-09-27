import { useEffect } from 'react';
import { Plus, Compass, LibraryBig, Settings2, ArrowUpRight } from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SearchPage } from '../features/search/SearchPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { LibraryProvider } from '../features/library/LibraryContext';
import { ManualEntryPage } from '../features/entries/ManualEntryPage';
import { PreferencesProvider, usePreferences } from '../features/settings/PreferencesContext';
import { SettingsPage } from '../features/settings/SettingsPage';
import styles from './App.module.css';

const links = [
  { to: '/library', label: 'Library', icon: LibraryBig },
  { to: '/search', label: 'Search', icon: Compass },
  { to: '/entry', label: 'Add entry', icon: Plus },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export function App() {
  return <PreferencesProvider><LibraryProvider><AppShell /></LibraryProvider></PreferencesProvider>;
}

function AppShell() {
  const { pathname } = useLocation();
  const { preferences } = usePreferences();
  useEffect(() => {
    document.title = 'Libra · ' + (links.find((link) => link.to === pathname)?.label ?? 'Search');
    if (window.scrollY) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className={styles.app}>
      <a href="#main-content" className={styles.skipLink}>Skip to content</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <NavLink to={preferences.home} className={styles.brand} aria-label="Libra home">
            <img src="/favicon.svg" width="30" height="30" alt="" />
            <span>libra</span>
          </NavLink>
          <nav aria-label="Main navigation" className={styles.nav}>
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} title={label} className={({ isActive }) => [styles.navLink, to === '/entry' ? styles.addLink : '', to === '/settings' ? styles.settingsLink : styles.mainLink, isActive ? styles.active : ''].join(' ')}>
                <Icon size={17} aria-hidden="true" /><span className={to === '/settings' ? styles.srOnly : undefined}>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to={preferences.home} replace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/entry" element={<ManualEntryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/search" replace />} />
      </Routes>
      <footer className={styles.footer}>
        <div className={styles.footerBrand}><strong>libra</strong><span>A little space for everything you love.</span></div>
        <details className={styles.credits}>
          <summary>Data & credits</summary>
          <div className={styles.creditsContent}>
            <img className={styles.tmdbLogo} src="https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB" width="90" height="12" loading="lazy" />
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">The Movie Database <ArrowUpRight size={14} /></a>
            <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
            <p>Anime and manga data from MyAnimeList via <a href="https://tenrai.org" target="_blank" rel="noreferrer">Tenrai <ArrowUpRight size={14} /></a>. Tenrai is not affiliated with MyAnimeList.</p>
            <p>Game data provided by <a href="https://www.igdb.com" target="_blank" rel="noreferrer">IGDB <ArrowUpRight size={14} /></a>.</p>
            <p>Book data and covers from <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library <ArrowUpRight size={14} /></a>, an Internet Archive initiative.</p>
          </div>
        </details>
      </footer>
    </div>
  );
}
