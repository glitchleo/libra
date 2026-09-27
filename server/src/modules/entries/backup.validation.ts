import { z } from 'zod';
import { manualEntrySchema, saveEntrySchema, statusSchema, tagSchema } from './entries.validation.js';

const tag = tagSchema.extend({ id: z.uuid() });
const manualItem = saveEntrySchema.shape.item.extend({ provider: z.literal('manual'), sourceId: z.uuid(), externalUrl: z.union([saveEntrySchema.shape.item.shape.externalUrl, z.literal('')]) });
const entry = z.strictObject({
  id: z.uuid(), item: z.union([saveEntrySchema.shape.item, manualItem]), providerName: z.string().min(1).max(100),
  status: statusSchema, addedAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  details: z.record(z.string(), z.union([z.string().max(500), z.number().finite()])).default({}), tags: z.array(tag).max(50),
}).superRefine((value, ctx) => {
  const { item } = value;
  if (item.provider === 'manual') {
    const parsed = manualEntrySchema.safeParse({ requestId: item.sourceId, mediaType: item.mediaType, title: item.title,
      originalTitle: item.originalTitle, description: item.overview, releaseDate: item.releaseDate, coverUrl: item.posterUrl,
      websiteUrl: item.externalUrl || null, status: value.status, details: value.details });
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: 'Invalid manual entry details.' });
  } else if (Object.keys(value.details).length) ctx.addIssue({ code: 'custom', message: 'Catalog entries cannot contain manual fields.' });
});

export const backupSchema = z.strictObject({
  format: z.literal('libra-library'), version: z.literal(1), exportedAt: z.iso.datetime(),
  tags: z.array(tag).max(10000), entries: z.array(entry).max(10000),
}).superRefine((backup, ctx) => {
  const tags = new Map(backup.tags.map((value) => [value.id, value.name]));
  const ids = new Set<string>(); const sources = new Set<string>();
  if (tags.size !== backup.tags.length) ctx.addIssue({ code: 'custom', message: 'Duplicate tag IDs in the backup.' });
  backup.entries.forEach((value, index) => {
    const key = [value.item.provider, value.item.provider === 'manual' ? '' : value.item.mediaType, value.item.sourceId].join(':');
    if (ids.has(value.id) || sources.has(key)) ctx.addIssue({ code: 'custom', path: ['entries', index], message: 'Duplicate entries in the backup.' });
    ids.add(value.id); sources.add(key);
    if (value.tags.some((tag) => tags.get(tag.id) !== tag.name)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'tags'], message: 'An entry references an unknown or inconsistent tag.' });
  });
});
export const importSchema = z.strictObject({ backup: backupSchema, mode: z.enum(['keep', 'update']).default('keep') });
