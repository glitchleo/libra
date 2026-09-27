# Manual entries

Choose **Add entry** in the navigation or Library header. An empty external search
also offers **Add this title manually**, carrying over the search title and type.
Select a media type and enter a title. All other fields are optional. After saving,
open the details in place, visit the Library, or start another entry.

Common fields are title, description, original/alternative title, release or
publication date, genres, language, cover image URL, website/reference URL, and
library status, and tags. Choose several existing tags or use **Create & select**
under **Organize with tags**. Tag creation does not submit the entry form. Selected
tags are saved in the same transaction as the new entry. The initial library status
comes from Settings. Dates accept a year or a valid `YYYY-MM-DD` date. Links must use
HTTPS. Covers use direct image links; file uploads are not implemented.

| Type | Additional fields |
| --- | --- |
| Movie | Director, runtime in minutes |
| TV series | Creator, seasons, episodes, episode runtime in minutes |
| Anime | Studio, episodes, episode runtime in minutes |
| Book | Author, publisher, pages, ISBN |
| Manga / Manhwa | Author, artist, volumes, chapters |
| Game | Developer, publisher, platforms, estimated playtime in hours |
| Audiobook | Author, narrator, duration in minutes |
| Other | Creator, format |

Unknown numbers are left blank. Counts and minute durations are positive integers;
estimated playtime accepts half-hour increments. Text details allow up to 500
characters. Switching type keeps the form's values available if you switch back,
but submits only fields relevant to the selected type. A failed save leaves the
form intact; successful creation clears it only when **Add another entry** is chosen.
Unsaved forms are not retained after reloading or navigating away.

## Storage and API

`POST /api/entries/manual` accepts `ManualEntryInput` from
`shared/src/types/manual-entry.ts`. Required fields are `requestId` (a UUID),
`mediaType`, and `title`. Optional fields are `originalTitle`, `description`,
`releaseDate`, `coverUrl`, `websiteUrl`, `status`, `details`, and `tagIds` (up to 50
existing tag UUIDs). Unknown tags fail the save without creating a partial entry.
Retries preserve the first saved entry and its tag assignments.

The client generates a request UUID and reuses it on retries. The server assigns
the entry ID and reserves the internal source `manual`; no catalog account or
provider credentials are needed. Duplicate requests return the first saved entry,
even if their media type changes. A new explicit form submission after **Add
another entry** gets a new request UUID; titles are not deduplicated by text.

The SQLite migration `002_manual_entries.sql` adds a validated JSON column with an
empty-object default for existing records. Values remain typed: numbers are stored
as JSON numbers. Shared field definitions control the form, server validation,
and detail labels. Unsupported fields or values, invalid dates, unsafe URL schemes,
and blank titles return HTTP 400. Imported entries still use the existing catalog
validation path.

Manual entries appear alongside imports, including type/status filters and search
across metadata values. The details panel shows **Added by you**, omits community
ratings, and only offers a website link when one was supplied. Status changes,
soft removal, and restoration preserve all manual metadata.

## Verification

API tests cover all nine media types, typed metadata validation, retry idempotence,
restoration, metadata search, valid dates, and migration of an existing database.
A file-backed test closes and reopens SQLite with both imported and manual entries.
React tests cover dynamic fields, required titles, submission failures, duplicate
clicks, adding another entry, browsing saved details, and removal/restoration.
