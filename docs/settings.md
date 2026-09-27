# Settings and backups

Open **Settings** from the navigation. On mobile the main navigation is fixed at
the bottom with space reserved for the device's safe area.

## Display preferences

Preferences save automatically in this browser under `libra.preferences.v1`:

- Library layout: large covers, small covers, or list with thumbnails. Library
  display buttons update the same preference. Compact covers omit descriptions
  to keep the layout readable; larger covers and list view respect the description switch.
- Default sort: recently added, title A–Z, or catalog rating. Sorting in Library
  also updates this preference.
- Default new-entry status: used for manual entry forms and new catalog saves.
- Start page: Search or Library, used for `/` and the Libra wordmark link.
- Library description, catalog rating, and tag-badge visibility.
- Reduced animations, in addition to the operating system's reduced-motion setting.

**Reset display preferences** resets these options without altering the library.
Preferences do not sync across devices and are not part of library backups. If
browser storage is blocked, changes work for the current visit and Settings shows
a notice. Corrupt or outdated preference values fall back to defaults.

## JSON exports

**Export JSON** downloads `libra-library-YYYY-MM-DD.json`. It includes every active
entry, across all pages and regardless of filters, plus all tags (including unused
ones). Titles, descriptions, type-specific details, catalog identities and links,
statuses, dates, and tag relationships are preserved. Images remain external URLs;
the image files themselves are not embedded. Removed entries, browser preferences,
and API credentials are excluded. The export is a consistent database snapshot.

The format is `{ format: 'libra-library', version: 1, exportedAt, tags, entries }`.
`entries` use `LibraryEntry` from the shared library types. The format supports up
to 10,000 entries, 10,000 tags, and a 25 MB JSON file. The server does not generate
backups beyond these supported limits.

## JSON imports

Choose a file, choose how matching entries are handled, and click **Preview import**.
Preview validates the entire file and reports additions, updates, kept entries,
restored entries, and new tags. It does not modify the database. Changing the file
or conflict option invalidates the preview. Click **Import into library** to save.

- **Keep my existing entry and tags** (default) leaves matching local entries as
  they are. New entries are added and removed matches become active again.
- **Use the backup entry and its tags** replaces a matching entry's saved metadata,
  status, dates, and tag assignments with the file's values. Entries not in the
  file remain untouched. Export first if you want to keep a copy of current values.

Matching is by provider, media type, and source ID. Custom entries match by their
original manual request ID, even across a type change. Matching titles alone are
not treated as duplicates. Names of tags are normalized and matched without case;
existing matching tags are reused. ID collisions belonging to unrelated entries
or tags are remapped, preserving both records and tag relationships. Reimporting
the same file does not create duplicate entries.

Imports are atomic: validation errors or database failures leave the library
unchanged. Unsupported versions, malformed metadata, unsafe URLs, duplicate
identities, and unknown tag references are rejected. The server revalidates and
recalculates the result on import, so concurrent library changes may alter the
counts from the preview. All backup writes use the same JSON and cross-site request
protections as entry writes. File contents go only to the connected Libra server.

## Verification

API tests cover full exports beyond a page, fresh-library round trips, repeated
imports, conflict modes, restoration, ID collisions, atomic rollback, invalid files,
and backups larger than the normal entry request limit. UI tests cover file validation,
preview/cancel/retry, export errors, preference persistence, start page, layout
switching, and creating/selecting tags before saving an entry.
