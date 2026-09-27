# Saved library

Open a catalog result and choose **Add to library**. Choose Planned, In progress,
Completed, On hold, or Dropped before saving, or change the status afterwards.
The entry stays open on the current screen. Saved search cards show **In library**.

The **Library** page lists saved entries with cover art and status. Search title,
original title, overview/author text, or tag name; filter by type, status, and tags; sort by recently
added, title, or catalog rating. Each page contains up to 24 entries. Summary counts
refer to the complete library, independent of active filters. Details open in the
same overlay with a **Back to library** control. Use the display buttons beside
**Your collection** to switch between small covers, large covers, and a list with
thumbnails. This choice and the sort order persist in this browser. On mobile,
**Filters** expands the media/status/tag controls; search and display controls stay
accessible. Settings also controls descriptions, ratings, and tag badges.

## Tags

Use **Manage tags** in Library to create, rename, or delete your own tags. Favorites,
Revisit, Recommended, and Hidden gems are included as editable defaults. Default
tags are seeded once, so renaming or deleting one survives restarts.

Open a saved entry and use **Your tags** to assign or unassign tags. Changes save
automatically, and **Create & assign** adds a new tag directly from the entry.
An entry can have multiple tags, and any tag can be shared across entries and media
types. Assigned tags also appear below the entry's card in Library.

Select tags under **Filter by tags** to show entries with **all** selected tags.
These filters combine with text, media type, and status. **All tags** clears just
the tag selection; **Clear filters** resets all search filters. Tag names can also
be typed in library search. Deleting a tag removes its assignments but keeps every
entry; removing and restoring an entry preserves its tags.

Names are limited to 40 characters, with whitespace normalized and case-insensitive
duplicate prevention. Each entry and filter selection supports up to 50 tags.
Tags live in `tags`, with a many-to-many `entry_tags` table and foreign keys. Migration
`003_library_tags.sql` preserves existing entries.

## Persistence

Node.js 24 or newer is required. Its built-in `node:sqlite` driver stores the library
at `database/data/libra.sqlite`, created automatically when the server starts.
`LIBRARY_DB_PATH` optionally selects another file; relative paths are resolved from
`server/` when running the documented workspace scripts. The database stays on the
server and is ignored by Git. No credentials or separate database service are needed.

Numbered SQL files in `database/migrations/` are applied transactionally on startup,
with applied versions recorded in `schema_migrations`. Existing data is preserved.
Stop the app before copying the SQLite file for a consistent backup. Restarting the
server, rebuilding the client, or refreshing the browser does not clear saved data.

One entry is stored per `(provider, media_type, source_id)`. Movies, series, games,
and books are not merged based on title text. Saving the same entry again is
idempotent and preserves its metadata snapshot and personal status. Imports accept
the normalized metadata currently shown in Search; they do not fetch a new provider
payload. Catalog metadata occupies separate columns from personal status. No personal
title/description overrides, automatic metadata refresh, progress
units or account system are implemented yet. JSON export/import is available in
Settings; see [settings and backups](settings.md).

**Add entry** creates manual titles without an external catalog. Type-specific
metadata is validated and stored as typed values in `details_json`; library search
includes these values (for example, author, director, or developer). A second
migration adds this column without changing existing imported records. See
[manual entries](manual-entries.md) for fields and request format.

**Remove from library** asks for confirmation in the entry panel and soft-deletes
the record. Adding that same catalog entry again restores its original ID,
metadata, added date, and status. The record is not permanently purged.
For a removed manual entry, choose **Restore to library** in its open panel. The
current UI does not have a separate trash page; restore it before closing that
panel. The API can also restore a known entry ID afterwards.

## API

| Request | Behavior |
| --- | --- |
| `GET /api/entries` | Paginated entries plus unfiltered summary counts |
| `GET /api/entries/index` | Compact identities, statuses, assigned tag IDs, and available tags |
| `POST /api/entries` | `{ item: CatalogItem, status?: LibraryStatus }`; returns `{ entry, created }` |
| `POST /api/entries/manual` | Validated manual input; returns `{ entry, created }` |
| `PATCH /api/entries/:id` | `{ status: LibraryStatus }`; returns `{ entry }` |
| `DELETE /api/entries/:id` | Reversible removal; returns `{ removed: true }` |
| `POST /api/entries/:id/restore` | Empty JSON body; restores an existing entry and returns `{ entry }` |
| `GET /api/entries/tags` | `{ tags: [{ id, name }] }` |
| `POST /api/entries/tags` | `{ name }`; returns `{ tag, created }`, reusing an existing name |
| `PATCH /api/entries/tags/:tagId` | `{ name }`; renames a tag everywhere; returns `{ tag }` |
| `DELETE /api/entries/tags/:tagId` | Removes the tag and assignments; returns `{ removed: true }` |
| `PATCH /api/entries/:id/tags` | `{ tagIds: string[] }`; replaces assignments atomically; `[]` clears them |
| `GET /api/entries/backup` | Downloads a versioned JSON snapshot of every active entry and tag |
| `POST /api/entries/backup/preview` | `{ backup, mode: 'keep' \| 'update' }`; validates and reports changes without writing |
| `POST /api/entries/backup/import` | Same payload; merges atomically and returns `{ summary }` |

List parameters: `query` (up to 200 characters), `mediaType`, `status`, `sort`
(`added_desc`, `title_asc`, `rating_desc`), `tagIds` (comma-separated UUIDs, matching all),
and `page` (one-based). Entries include a `tags` array of `{ id, name }`. The API clamps
pages after removals to the last available page. `%` and `_` are literal search
characters, not SQL wildcards. SQL values are bound parameters and sort expressions
come from a server-owned allowlist.

New saves and re-adds return HTTP 201; already-saved entries and explicit restores return HTTP 200. Repeat
removal is safe. Invalid inputs return 400, missing active entries return 404 on
status updates, unsupported body formats return 415, and oversized bodies return
413. Writes require JSON where applicable; cross-site browser writes are rejected.
Imported source/media combinations and catalog/image hosts are validated before
storing. Manual entries accept optional HTTPS image and reference URLs without
requiring a catalog host.

The client updates shared saved-state only after successful writes. Failed writes
remain retryable, duplicate clicks are disabled while saving, and stale index reads
cannot overwrite newer mutations. Library index data refreshes on window focus.
Search remains usable if the library API is unavailable.

## Validation

Tests use isolated SQLite databases, including a temporary file closed and reopened
to verify persistence. They cover concurrent duplicate saves, distinct identities,
status retention, reversible removal, filters, sorting, pagination, migration reuse,
request validation, and the full client add/browse/update/remove workflow. Tag tests
cover shared assignments, combined filters, duplicate names, atomic failed updates,
renaming/deletion, restore and restart persistence, and client failure recovery.
