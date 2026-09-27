import { z } from 'zod';
import { libraryStatuses } from '@libra/shared/library';
import { commonDetailFields, mediaDetailFields } from '@libra/shared/manual-entry';

const mediaType = z.enum(['movie', 'tv', 'anime', 'book', 'manga', 'manhwa', 'game', 'audiobook', 'other']);
export const statusSchema = z.enum(libraryStatuses);
const httpsUrl = z.url().max(2048).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port;
});
export const saveEntrySchema = z.strictObject({
  item: z.strictObject({
    provider: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), sourceId: z.string().regex(/^(?:[1-9]\d{0,14}|OL\d+[WM])$/), mediaType,
    title: z.string().trim().min(1).max(2000), originalTitle: z.string().max(2000), overview: z.string().max(50000),
    releaseDate: z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/).nullable(), posterUrl: httpsUrl.nullable(),
    rating: z.number().min(0).max(10).nullable(), voteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), externalUrl: httpsUrl,
  }),
  status: statusSchema.default('planned'),
});
export const libraryQuerySchema = z.strictObject({
  query: z.string().trim().max(200).optional(), mediaType: mediaType.optional(), status: statusSchema.optional(),
  sort: z.enum(['added_desc', 'title_asc', 'rating_desc']).default('added_desc'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  tagIds: z.string().max(1849).transform((value) => value.split(',')).pipe(z.array(z.uuid()).max(50)).optional(),
});
export const updateEntrySchema = z.strictObject({ status: statusSchema });
export const entryIdSchema = z.uuid();
export const tagSchema = z.strictObject({
  name: z.string().transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(1).max(40).regex(/^[^\p{Cc}\p{Cf}]+$/u)),
});
export const entryTagsSchema = z.strictObject({ tagIds: z.array(z.uuid()).max(50).transform((ids) => [...new Set(ids)]) });

const manualDate = z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/, 'Use a year or YYYY-MM-DD for the release date.').refine((value) => {
  if (!/^[1-9]\d{3}/.test(value)) return false;
  if (value.length === 4) return true;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid release date.');

export const manualEntrySchema = z.strictObject({
  requestId: z.uuid(), mediaType,
  title: z.string().trim().min(1, 'Enter a title.').max(2000, 'Keep the title under 2,000 characters.'),
  originalTitle: z.string().trim().max(2000).default(''),
  description: z.string().trim().max(50000).default(''),
  releaseDate: manualDate.nullable().default(null),
  coverUrl: httpsUrl.nullable().default(null), websiteUrl: httpsUrl.nullable().default(null),
  status: statusSchema.default('planned'),
  details: z.record(z.string(), z.union([z.string().trim().max(500), z.number().finite()])).default({}),
  tagIds: entryTagsSchema.shape.tagIds.optional(),
}).superRefine((entry, context) => {
  const fields = [...commonDetailFields, ...mediaDetailFields[entry.mediaType]];
  for (const [key, value] of Object.entries(entry.details)) {
    const field = fields.find((candidate) => candidate.key === key);
    if (!field) {
      context.addIssue({ code: 'custom', path: ['details', key], message: 'This field does not apply to the selected media type.' });
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || value <= 0 || value > field.max || !Number.isInteger(value / (field.step ?? 1))) {
        context.addIssue({ code: 'custom', path: ['details', key], message: `Enter a valid value for ${field.label.toLowerCase()}, or leave it blank.` });
      }
    } else if (typeof value !== 'string') {
      context.addIssue({ code: 'custom', path: ['details', key], message: `Enter text for ${field.label.toLowerCase()}.` });
    }
  }
});
