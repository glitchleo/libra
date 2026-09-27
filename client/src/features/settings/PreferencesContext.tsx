import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { libraryStatuses } from '@libra/shared/library';
import type { LibrarySort, LibraryStatus } from '@libra/shared/library';

export type LibraryView = 'small' | 'large' | 'list';
export interface Preferences {
  view: LibraryView; sort: LibrarySort; defaultStatus: LibraryStatus; home: '/search' | '/library';
  descriptions: boolean; ratings: boolean; tags: boolean; reducedMotion: boolean;
}
export const defaultPreferences: Preferences = { view: 'large', sort: 'added_desc', defaultStatus: 'planned', home: '/search', descriptions: true, ratings: true, tags: true, reducedMotion: false };
const key = 'libra.preferences.v1';
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object') return { ...defaultPreferences };
    return {
      view: ['small', 'large', 'list'].includes(value.view) ? value.view : defaultPreferences.view,
      sort: ['added_desc', 'title_asc', 'rating_desc'].includes(value.sort) ? value.sort : defaultPreferences.sort,
      defaultStatus: libraryStatuses.includes(value.defaultStatus) ? value.defaultStatus : defaultPreferences.defaultStatus,
      home: value.home === '/library' ? '/library' : '/search',
      descriptions: typeof value.descriptions === 'boolean' ? value.descriptions : true,
      ratings: typeof value.ratings === 'boolean' ? value.ratings : true,
      tags: typeof value.tags === 'boolean' ? value.tags : true,
      reducedMotion: value.reducedMotion === true,
    };
  } catch { return { ...defaultPreferences }; }
}
const PreferencesContext = createContext<{ preferences: Preferences; update(value: Partial<Preferences>): void; reset(): void; storageError: string } | null>(null);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(preferences)); setStorageError(''); }
    catch { setStorageError('Browser storage is unavailable. Preferences will last for this visit only.'); }
    document.documentElement.dataset.reduceMotion = String(preferences.reducedMotion);
  }, [preferences]);
  return <PreferencesContext.Provider value={{ preferences, update: (value) => setPreferences((current) => ({ ...current, ...value })), reset: () => setPreferences({ ...defaultPreferences }), storageError }}>{children}</PreferencesContext.Provider>;
}
export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('PreferencesProvider is required');
  return value;
}
