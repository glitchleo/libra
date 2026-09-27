import type { MediaType } from './search.js';
import type { LibraryStatus } from './library.js';

export interface DetailField {
  key: string;
  label: string;
  type: 'text' | 'number';
  max: number;
  step?: number;
}

const text = (key: string, label: string): DetailField => ({ key, label, type: 'text', max: 500 });
const count = (key: string, label: string, max = 100000): DetailField => ({ key, label, type: 'number', max, step: 1 });
export const commonDetailFields: DetailField[] = [text('genres', 'Genres'), text('language', 'Language')];
export const mediaDetailFields: Record<MediaType, DetailField[]> = {
  movie: [text('director', 'Director'), count('runtimeMinutes', 'Runtime (minutes)', 10000)],
  tv: [text('creator', 'Creator'), count('seasons', 'Seasons'), count('episodes', 'Episodes'), count('episodeMinutes', 'Episode runtime (minutes)', 10000)],
  anime: [text('studio', 'Studio'), count('episodes', 'Episodes'), count('episodeMinutes', 'Episode runtime (minutes)', 10000)],
  book: [text('author', 'Author'), text('publisher', 'Publisher'), count('pages', 'Pages'), text('isbn', 'ISBN')],
  manga: [text('author', 'Author'), text('artist', 'Artist'), count('volumes', 'Volumes'), count('chapters', 'Chapters')],
  manhwa: [text('author', 'Author'), text('artist', 'Artist'), count('volumes', 'Volumes'), count('chapters', 'Chapters')],
  game: [text('developer', 'Developer'), text('publisher', 'Publisher'), text('platforms', 'Platforms'), { key: 'playtimeHours', label: 'Estimated playtime (hours)', type: 'number', max: 100000, step: 0.5 }],
  audiobook: [text('author', 'Author'), text('narrator', 'Narrator'), count('durationMinutes', 'Duration (minutes)', 100000)],
  other: [text('creator', 'Creator'), text('format', 'Format')],
};

export type MediaDetails = Record<string, string | number>;
export interface ManualEntryInput {
  // Reused on retries so a lost response cannot create a second entry.
  requestId: string;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  description: string;
  releaseDate: string | null;
  coverUrl: string | null;
  websiteUrl: string | null;
  status: LibraryStatus;
  details: MediaDetails;
  tagIds?: string[];
}
