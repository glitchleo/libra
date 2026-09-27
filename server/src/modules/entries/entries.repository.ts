import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { sqliteStore, type Store } from '../../db/store.js';
import type { CatalogItem } from '@libra/shared/search';
import type { ManualEntryInput, MediaDetails } from '@libra/shared/manual-entry';
import type { LibraryEntry, LibraryIdentity, LibraryQuery, LibraryResponse, LibraryStatus, LibraryTag, SaveEntryResponse } from '@libra/shared/library';
import { HttpError } from '../../middleware/errors.js';
import type { ImportMode, ImportSummary, LibraryBackup } from '@libra/shared/library';
interface EntryRow {
    id: string;
    provider: string;
    source_id: string;
    media_type: CatalogItem['mediaType'];
    provider_name: string;
    title: string;
    original_title: string;
    overview: string;
    release_date: string | null;
    poster_url: string | null;
    catalog_rating: number | null;
    catalog_vote_count: number;
    external_url: string;
    status: LibraryStatus;
    added_at: string;
    updated_at: string;
    deleted_at: string | null;
    details_json: string;
}
function toEntry(row: EntryRow, tags: LibraryTag[]): LibraryEntry {
    return {
        id: row.id, providerName: row.provider_name, status: row.status, addedAt: row.added_at, updatedAt: row.updated_at,
        details: JSON.parse(row.details_json) as MediaDetails, tags,
        item: { provider: row.provider, sourceId: row.source_id, mediaType: row.media_type, title: row.title,
            originalTitle: row.original_title, overview: row.overview, releaseDate: row.release_date,
            posterUrl: row.poster_url, rating: row.catalog_rating, voteCount: row.catalog_vote_count, externalUrl: row.external_url },
    };
}
export class EntriesRepository {
    private db: Store;
    constructor(db: DatabaseSync | Store) { this.db = 'dialect' in db ? db : sqliteStore(db); }
    async index(): Promise<LibraryIdentity[]> {
        return this.db.transaction(async () => {
            const assignments = new Map<string, string[]>();
            for (const row of (await this.db.prepare('SELECT entry_id, tag_id FROM entry_tags JOIN entries ON entries.id = entry_id WHERE deleted_at IS NULL').all())) {
                const id = String(row.entry_id);
                assignments.set(id, [...(assignments.get(id) ?? []), String(row.tag_id)]);
            }
            return ((await this.db.prepare(`SELECT id, provider, source_id AS "sourceId", media_type AS "mediaType", status
      FROM entries WHERE deleted_at IS NULL`).all()) as unknown as LibraryIdentity[])
                .map((entry) => ({ ...entry, tagIds: assignments.get(entry.id) ?? [] }));
        });
    }
    async tags(): Promise<LibraryTag[]> {
        return this.db.transaction(async () => {
            return (await this.db.prepare('SELECT id, name FROM tags ORDER BY name COLLATE NOCASE, id').all()) as unknown as LibraryTag[];
        });
    }
    private async entryTags(id: string): Promise<LibraryTag[]> {
        return this.db.transaction(async () => {
            return (await this.db.prepare(`SELECT tags.id, tags.name FROM tags JOIN entry_tags ON tag_id = tags.id
      WHERE entry_id = ? ORDER BY tags.name COLLATE NOCASE, tags.id`).all(id)) as unknown as LibraryTag[];
        });
    }
    async createTag(name: string): Promise<{
        tag: LibraryTag;
        created: boolean;
    }> {
        return this.db.transaction(async () => {
            const id = randomUUID();
            const key = name.toLowerCase();
            const result = (await this.db.prepare('INSERT INTO tags (id, name, name_key) VALUES (?, ?, ?) ON CONFLICT(name_key) DO NOTHING').run(id, name, key));
            const tag = (await this.db.prepare('SELECT id, name FROM tags WHERE name_key = ?').get(key)) as unknown as LibraryTag;
            return { tag, created: Number(result.changes) > 0 };
        });
    }
    async renameTag(id: string, name: string): Promise<LibraryTag> {
        return this.db.transaction(async () => {
            if (!(await this.db.prepare('SELECT id FROM tags WHERE id = ?').get(id)))
                throw new HttpError(404, 'TAG_NOT_FOUND', 'This tag no longer exists.');
            if ((await this.db.prepare('SELECT id FROM tags WHERE name_key = ? AND id <> ?').get(name.toLowerCase(), id))) {
                throw new HttpError(409, 'TAG_EXISTS', 'A tag with this name already exists.');
            }
            (await this.db.prepare('UPDATE tags SET name = ?, name_key = ? WHERE id = ?').run(name, name.toLowerCase(), id));
            return { id, name };
        });
    }
    async deleteTag(id: string): Promise<void> {
        return this.db.transaction(async () => { (await this.db.prepare('DELETE FROM tags WHERE id = ?').run(id)); });
    }
    async setTags(id: string, tagIds: string[]): Promise<LibraryEntry> {
        return this.db.transaction(async () => {
            if (!(await this.get(id)))
                throw new HttpError(404, 'ENTRY_NOT_FOUND', 'This entry is no longer in your library.');
            for (const tagId of tagIds) {
                if (!(await this.db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId)))
                    throw new HttpError(404, 'TAG_NOT_FOUND', 'A selected tag no longer exists. Refresh and try again.');
            }
            (await this.db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id));
            const insert = this.db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
            for (const tagId of new Set(tagIds))
                (await insert.run(id, tagId));
            (await this.db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id));
            const entry = (await this.get(id))!;
            return entry;
        });
    }
    async get(id: string): Promise<LibraryEntry | null> {
        return this.db.transaction(async () => {
            const row = (await this.db.prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL').get(id)) as unknown as EntryRow | undefined;
            return row ? toEntry(row, (await this.entryTags(row.id))) : null;
        });
    }
    async save(item: CatalogItem, providerName: string, status: LibraryStatus, details: MediaDetails = {}, tagIds: string[] = []): Promise<SaveEntryResponse> {
        return this.db.transaction(async () => {
            const now = new Date().toISOString();
            const row = (await this.db.prepare("SELECT * FROM entries WHERE provider = ? AND source_id = ? AND (media_type = ? OR provider = 'manual')")
                .get(item.provider, item.sourceId, item.mediaType)) as unknown as EntryRow | undefined;
            let created = false;
            let id = row?.id;
            if (row) {
                if (row.deleted_at) {
                    (await this.db.prepare('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, row.id));
                    created = true;
                }
            }
            else {
                for (const tagId of tagIds) {
                    if (!(await this.db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId)))
                        throw new HttpError(400, 'TAG_NOT_FOUND', 'A selected tag no longer exists. Refresh the tags and try again.');
                }
                id = randomUUID();
                (await this.db.prepare(`INSERT INTO entries (id, provider, source_id, media_type, provider_name, title, original_title,
          overview, release_date, poster_url, catalog_rating, catalog_vote_count, external_url, status, added_at, updated_at, details_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(id, item.provider, item.sourceId, item.mediaType, providerName, item.title, item.originalTitle, item.overview, item.releaseDate, item.posterUrl, item.rating, item.voteCount, item.externalUrl, status, now, now, JSON.stringify(details)));
                for (const tagId of new Set(tagIds))
                    (await this.db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(id, tagId));
                created = true;
            }
            const entry = (await this.get(id!))!;
            // Duplicate saves and restores retain the original snapshot and personal status.
            return { entry, created };
        });
    }
    async createManual(input: ManualEntryInput): Promise<SaveEntryResponse> {
        return this.db.transaction(async () => {
            return (await this.save({
                provider: 'manual', sourceId: input.requestId, mediaType: input.mediaType,
                title: input.title, originalTitle: input.originalTitle, overview: input.description,
                releaseDate: input.releaseDate, posterUrl: input.coverUrl, externalUrl: input.websiteUrl ?? '',
                rating: null, voteCount: 0,
            }, 'Manual entry', input.status, input.details, input.tagIds));
        });
    }
    async exportBackup(): Promise<LibraryBackup> {
        return this.db.transaction(async () => {
            const entries = (await Promise.all(((await this.db.prepare('SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY added_at, id').all()) as unknown as EntryRow[])
                .map(async (row) => toEntry(row, (await this.entryTags(row.id))))));
            const backup: LibraryBackup = { format: 'libra-library', version: 1, exportedAt: new Date().toISOString(), tags: (await this.tags()), entries };
            return backup;
        });
    }
    private async findImportEntry(entry: LibraryEntry): Promise<EntryRow | undefined> {
        return this.db.transaction(async () => {
            return (await this.db.prepare("SELECT * FROM entries WHERE provider = ? AND source_id = ? AND (media_type = ? OR provider = 'manual')")
                .get(entry.item.provider, entry.item.sourceId, entry.item.mediaType)) as unknown as EntryRow | undefined;
        });
    }
    async previewImport(backup: LibraryBackup, mode: ImportMode): Promise<ImportSummary> {
        return this.db.transaction(async () => {
            const summary: ImportSummary = { totalEntries: backup.entries.length, totalTags: backup.tags.length, added: 0, updated: 0, kept: 0, restored: 0, tagsAdded: 0 };
            for (const entry of backup.entries) {
                const existing = (await this.findImportEntry(entry));
                if (!existing)
                    summary.added++;
                else {
                    if (existing.deleted_at)
                        summary.restored++;
                    if (mode === 'update')
                        summary.updated++;
                    else
                        summary.kept++;
                }
            }
            const names = new Set((await this.tags()).map((tag) => tag.name.toLowerCase()));
            for (const tag of backup.tags) {
                if (!names.has(tag.name.toLowerCase())) {
                    summary.tagsAdded++;
                    names.add(tag.name.toLowerCase());
                }
            }
            return summary;
        });
    }
    async importBackup(backup: LibraryBackup, mode: ImportMode): Promise<ImportSummary> {
        return this.db.transaction(async () => {
            const summary = (await this.previewImport(backup, mode));
            const tagMap = new Map<string, string>();
            for (const tag of backup.tags) {
                const existing = (await this.db.prepare('SELECT id FROM tags WHERE name_key = ?').get(tag.name.toLowerCase()));
                const id = existing ? String(existing.id) : (await this.db.prepare('SELECT id FROM tags WHERE id = ?').get(tag.id)) ? randomUUID() : tag.id;
                if (!existing)
                    (await this.db.prepare('INSERT INTO tags (id, name, name_key) VALUES (?, ?, ?)').run(id, tag.name, tag.name.toLowerCase()));
                tagMap.set(tag.id, id);
            }
            for (const entry of backup.entries) {
                const existing = (await this.findImportEntry(entry));
                if (existing && mode === 'keep') {
                    if (existing.deleted_at)
                        (await this.db.prepare('UPDATE entries SET deleted_at = NULL WHERE id = ?').run(existing.id));
                    continue;
                }
                const id = existing?.id ?? ((await this.db.prepare('SELECT id FROM entries WHERE id = ?').get(entry.id)) ? randomUUID() : entry.id);
                const { item } = entry;
                (await this.db.prepare(`INSERT INTO entries (id, provider, source_id, media_type, provider_name, title, original_title,
          overview, release_date, poster_url, catalog_rating, catalog_vote_count, external_url, status, added_at, updated_at, details_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET media_type=excluded.media_type, provider_name=excluded.provider_name,
          title=excluded.title, original_title=excluded.original_title, overview=excluded.overview, release_date=excluded.release_date,
          poster_url=excluded.poster_url, catalog_rating=excluded.catalog_rating, catalog_vote_count=excluded.catalog_vote_count,
          external_url=excluded.external_url, status=excluded.status, added_at=excluded.added_at, updated_at=excluded.updated_at,
          details_json=excluded.details_json, deleted_at=NULL`)
                    .run(id, item.provider, item.sourceId, item.mediaType, entry.providerName, item.title, item.originalTitle, item.overview, item.releaseDate, item.posterUrl, item.rating, item.voteCount, item.externalUrl, entry.status, entry.addedAt, entry.updatedAt, JSON.stringify(entry.details ?? {})));
                (await this.db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id));
                for (const tagId of new Set(entry.tags.map((tag) => tagMap.get(tag.id)!))) {
                    (await this.db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(id, tagId));
                }
            }
            return summary;
        });
    }
    async restore(id: string): Promise<LibraryEntry | null> {
        return this.db.transaction(async () => {
            (await this.db.prepare('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
                .run(new Date().toISOString(), id));
            return (await this.get(id));
        });
    }
    async updateStatus(id: string, status: LibraryStatus): Promise<LibraryEntry | null> {
        return this.db.transaction(async () => {
            (await this.db.prepare('UPDATE entries SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
                .run(status, new Date().toISOString(), id));
            return (await this.get(id));
        });
    }
    async remove(id: string): Promise<void> {
        return this.db.transaction(async () => {
            const now = new Date().toISOString();
            (await this.db.prepare('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id));
        });
    }
    async list(query: LibraryQuery): Promise<LibraryResponse> {
        return this.db.transaction(async () => {
            const conditions = ['deleted_at IS NULL'];
            const values: SQLInputValue[] = [];
            if (query.query) {
                // User % and _ characters are literal search text, not SQL wildcards.
                const text = '%' + query.query.replace(/[\\%_]/g, '\\$&') + '%';
                conditions.push("(title LIKE ? ESCAPE '\\' OR original_title LIKE ? ESCAPE '\\' OR overview LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(entries.details_json) WHERE CAST(json_each.value AS TEXT) LIKE ? ESCAPE '\\') OR EXISTS (SELECT 1 FROM entry_tags JOIN tags ON tags.id = tag_id WHERE entry_id = entries.id AND tags.name LIKE ? ESCAPE '\\'))");
                values.push(text, text, text, text, text);
            }
            if (query.mediaType) {
                conditions.push('media_type = ?');
                values.push(query.mediaType);
            }
            if (query.status) {
                conditions.push('status = ?');
                values.push(query.status);
            }
            for (const tagId of new Set(query.tagIds ?? [])) {
                conditions.push('EXISTS (SELECT 1 FROM entry_tags WHERE entry_id = entries.id AND tag_id = ?)');
                values.push(tagId);
            }
            const where = conditions.join(' AND ');
            const totalResults = Number((await this.db.prepare('SELECT count(*) AS count FROM entries WHERE ' + where).get(...values))!.count);
            const totalPages = Math.max(1, Math.ceil(totalResults / 24));
            const page = Math.min(query.page ?? 1, totalPages);
            const sort = { added_desc: 'added_at DESC, id', title_asc: 'title COLLATE NOCASE, id', rating_desc: 'catalog_rating DESC, title COLLATE NOCASE, id' }[query.sort ?? 'added_desc'];
            const entries = (await Promise.all(((await this.db.prepare('SELECT * FROM entries WHERE ' + where + ' ORDER BY ' + sort + ' LIMIT 24 OFFSET ?')
                .all(...values, (page - 1) * 24)) as unknown as EntryRow[]).map(async (row) => toEntry(row, (await this.entryTags(row.id))))));
            const counts = (await this.db.prepare('SELECT status, count(*) AS count FROM entries WHERE deleted_at IS NULL GROUP BY status').all());
            const byStatus = Object.fromEntries(counts.map((row) => [row.status, Number(row.count)]));
            return { entries, page, totalPages, totalResults, summary: { total: counts.reduce((sum, row) => sum + Number(row.count), 0), byStatus } };
        });
    }
}
