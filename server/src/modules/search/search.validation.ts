import { z } from 'zod';

export const searchQuerySchema = z.strictObject({
  provider: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  query: z.string().trim().min(1).max(200),
  mediaType: z.enum(['movie', 'tv', 'anime', 'book', 'manga', 'manhwa', 'game', 'audiobook', 'other']),
  page: z.coerce.number().int().min(1).max(500).default(1),
  year: z.coerce.number().int().min(1000).max(9999).optional(),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).optional(),
  includeAdult: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
