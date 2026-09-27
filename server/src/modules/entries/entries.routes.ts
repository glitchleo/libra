import { Router } from 'express';
import type { ProviderRegistry } from '../../providers/catalog-provider.js';
import { HttpError } from '../../middleware/errors.js';
import type { EntriesRepository } from './entries.repository.js';
import { entryIdSchema, entryTagsSchema, libraryQuerySchema, manualEntrySchema, saveEntrySchema, tagSchema, updateEntrySchema } from './entries.validation.js';
import { backupSchema, importSchema } from './backup.validation.js';
import { backupMaxBytes } from '@libra/shared/library';

const hosts: Record<string, { source: string; images: string }> = {
  tmdb: { source: 'www.themoviedb.org', images: 'image.tmdb.org' },
  tenrai: { source: 'myanimelist.net', images: 'cdn.myanimelist.net' },
  igdb: { source: 'www.igdb.com', images: 'images.igdb.com' },
  openlibrary: { source: 'openlibrary.org', images: 'covers.openlibrary.org' },
};

export function createEntriesRouter(repository: EntriesRepository, providers: ProviderRegistry) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/backup', (_req, res) => {
    const backup = repository.exportBackup();
    const json = JSON.stringify(backup, null, 2);
    if (Buffer.byteLength(json) > backupMaxBytes || !backupSchema.safeParse(backup).success) throw new HttpError(413, 'BACKUP_TOO_LARGE', 'This library exceeds the supported backup format or 25 MB limit.');
    res.setHeader('Content-Disposition', `attachment; filename="libra-library-${backup.exportedAt.slice(0, 10)}.json"`);
    res.type('application/json').send(json);
  });
  router.post(['/backup/preview', '/backup/import'], (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_BACKUP', 'Choose a valid Libra version 1 backup. ' + (parsed.error.issues[0]?.message ?? 'Check the file contents.'));
    const { backup, mode } = parsed.data;
    for (const entry of backup.entries) {
      const { item } = entry;
      if (item.provider === 'manual') continue;
      const provider = providers.get(item.provider); const allowed = hosts[item.provider];
      if (!provider || !allowed || !provider.info.mediaTypes.includes(item.mediaType) ||
          (item.provider === 'openlibrary') !== /^OL\d+[WM]$/.test(item.sourceId) ||
          new URL(item.externalUrl).hostname !== allowed.source || (item.posterUrl && new URL(item.posterUrl).hostname !== allowed.images)) {
        throw new HttpError(400, 'INVALID_BACKUP', 'A backup entry has an unsupported catalog or invalid links.');
      }
    }
    res.json({ summary: req.path.endsWith('/preview') ? repository.previewImport(backup, mode) : repository.importBackup(backup, mode) });
  });
  router.get('/index', (_req, res) => res.json({ entries: repository.index(), tags: repository.tags() }));
  router.get('/tags', (_req, res) => res.json({ tags: repository.tags() }));
  router.post('/tags', (req, res) => {
    const parsed = tagSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_TAG', 'Use a tag name between 1 and 40 characters.');
    const result = repository.createTag(parsed.data.name);
    res.status(result.created ? 201 : 200).json(result);
  });
  router.use('/tags/:tagId', (req, _res, next) => {
    if (!entryIdSchema.safeParse(req.params.tagId).success) throw new HttpError(400, 'INVALID_TAG_ID', 'Choose a valid tag.');
    next();
  });
  router.patch('/tags/:tagId', (req, res) => {
    const parsed = tagSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_TAG', 'Use a tag name between 1 and 40 characters.');
    res.json({ tag: repository.renameTag(String(req.params.tagId), parsed.data.name) });
  });
  router.delete('/tags/:tagId', (req, res) => { repository.deleteTag(String(req.params.tagId)); res.json({ removed: true }); });
  router.get('/', (req, res) => {
    const parsed = libraryQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'INVALID_LIBRARY_QUERY', 'Check the library filters and page number.');
    res.json(repository.list(parsed.data));
  });
  router.post('/', (req, res) => {
    const parsed = saveEntrySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_ENTRY', 'This entry contains invalid or incomplete information. Search for it again and retry.');
    const { item, status } = parsed.data;
    const provider = providers.get(item.provider);
    const allowed = hosts[item.provider];
    if (!provider || !provider.info.mediaTypes.includes(item.mediaType) || !allowed) {
      throw new HttpError(400, 'INVALID_ENTRY_SOURCE', 'Choose an entry from a supported catalog.');
    }
    if ((item.provider === 'openlibrary') !== /^OL\d+[WM]$/.test(item.sourceId) ||
        new URL(item.externalUrl).hostname !== allowed.source || (item.posterUrl && new URL(item.posterUrl).hostname !== allowed.images)) {
      throw new HttpError(400, 'INVALID_ENTRY_SOURCE', 'The entry links do not match its catalog.');
    }
    const result = repository.save(item, provider.info.name, status);
    res.status(result.created ? 201 : 200).json(result);
  });
  router.post('/manual', (req, res) => {
    const parsed = manualEntrySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_MANUAL_ENTRY', parsed.error.issues[0]?.message ?? 'Check the entry details and try again.');
    const result = repository.createManual(parsed.data);
    res.status(result.created ? 201 : 200).json(result);
  });
  router.use('/:id', (req, _res, next) => {
    if (!entryIdSchema.safeParse(req.params.id).success) throw new HttpError(400, 'INVALID_ENTRY_ID', 'Choose a valid library entry.');
    next();
  });
  router.patch('/:id', (req, res) => {
    const parsed = updateEntrySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_ENTRY_STATUS', 'Choose a valid library status.');
    const entry = repository.updateStatus(String(req.params.id), parsed.data.status);
    if (!entry) throw new HttpError(404, 'ENTRY_NOT_FOUND', 'This entry is no longer in your library.');
    res.json({ entry });
  });
  router.patch('/:id/tags', (req, res) => {
    const parsed = entryTagsSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_ENTRY_TAGS', 'Choose up to 50 valid tags for this entry.');
    res.json({ entry: repository.setTags(String(req.params.id), parsed.data.tagIds) });
  });
  router.delete('/:id', (req, res) => { repository.remove(String(req.params.id)); res.json({ removed: true }); });
  router.post('/:id/restore', (req, res) => {
    const entry = repository.restore(String(req.params.id));
    if (!entry) throw new HttpError(404, 'ENTRY_NOT_FOUND', 'This entry could not be found.');
    res.json({ entry });
  });
  return router;
}
