import { BookAudio, BookOpen, Clapperboard, Film, Gamepad2, LibraryBig, Tv } from 'lucide-react';
import type { MediaType } from '@libra/shared/search';

export const mediaPresentation = {
  movie: { singular: 'Movie', plural: 'Movies', icon: Film },
  tv: { singular: 'Series', plural: 'TV series', icon: Tv },
  anime: { singular: 'Anime', plural: 'Anime', icon: Clapperboard },
  book: { singular: 'Book', plural: 'Books', icon: BookOpen },
  manga: { singular: 'Manga', plural: 'Manga', icon: BookOpen },
  manhwa: { singular: 'Manhwa', plural: 'Manhwa', icon: BookOpen },
  game: { singular: 'Game', plural: 'Games', icon: Gamepad2 },
  audiobook: { singular: 'Audiobook', plural: 'Audiobooks', icon: BookAudio },
  other: { singular: 'Title', plural: 'Other titles', icon: LibraryBig },
} satisfies Record<MediaType, { singular: string; plural: string; icon: typeof Film }>;
