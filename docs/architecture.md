# Libra architecture

Libra uses one repository containing a React client, an Express API, shared
TypeScript contracts, and versioned SQLite schema files. The initial personal
library uses Node's built-in SQLite driver and a local file, as selected for this
stage of development. PostgreSQL was the original plan and remains a possible
future migration. Start with one server and one database; feature folders provide
boundaries as the application grows.

## Client organization

Keep code close to the feature that uses it. For example, `client/src/features/entries/`
can eventually contain:

```text
entries/
├── components/                  # Entry-specific controls and editable sections
├── pages/                       # EntryDetailPage.tsx and entry creation
├── hooks/                       # Entry-specific state and data loading
├── entries.api.ts               # Entry API requests using src/api's HTTP client
└── entries.types.ts             # UI-only types specific to this feature
```

Create these files and subfolders when needed. A component and its CSS Module
belong together, for example `EntryCard.tsx` and `EntryCard.module.css`. Put CSS
resets, theme variables, and base styles in `client/src/styles/`. Move components,
hooks, or helpers into the shared client folders when multiple features use them.

`library` owns browsing and searching the saved collection, including personal
titles, descriptions, tags, and structured fields. `search` owns external catalog
search, provider selection, provider-supported filters, and import controls.
`entries` owns detail pages, manual creation, personal edits, cover selection,
progress, section visibility, and entry layout controls.

## Server organization

Within each `server/src/modules/` feature, add files as the feature needs them:

```text
entries/
├── entries.routes.ts            # Express routes and request/response handling
├── entries.service.ts           # Business rules and workflow coordination
├── entries.repository.ts        # Parameterized database queries
└── entries.validation.ts        # Server-only request validation
```

Routes validate input and call repositories directly for simple library CRUD.
Add services when workflow coordination is needed across repositories or provider
adapters. Repositories contain SQL for their feature; `server/src/db/`
opens SQLite and applies migrations transactionally. SQL schema changes belong
in `database/migrations/`, with ordered names such as `001_initial_schema.sql`.

`entries` also handles saved-library queries, filters, and sorting, so a second
library storage module is unnecessary. `collections` stores filter definitions
and reuses library query logic. `search` coordinates provider searches and passes
normalized imports to the entry service. Provider-specific requests, credentials,
response parsing, and supported-filter capabilities belong in `providers/`.

## Shared code

`shared/src/types/` holds client/server contracts such as `MediaType`, `Entry`,
`TagGroup`, `LibraryFilter`, and API request/response types. Share the contracts
actually needed by both sides; keep database row types and provider response
types inside the server.

`shared/src/validation/` holds reusable runtime checks or schemas once a validation
approach is chosen. TypeScript types alone do not validate incoming JSON. The
server must validate requests even when the client performs the same checks.

Shared code must not depend on React, Express, database connections, secrets, or
browser-only APIs. The client talks to the server API; it never accesses SQLite
or private provider credentials directly.

## Data design rules

### Keep imported information separate from personal edits

Store provider identity and imported metadata separately from personal overrides.
Compute the displayed entry from the imported values plus any explicit overrides.
Removing an override restores the imported value. Distinguish an absent override
from an intentional empty value, and preserve this distinction in backups.

Retain original provider payloads when useful for provenance or future reimports,
while mapping usable metadata into validated, typed values. Import refreshes must
preserve personal edits.

### Give tag groups explicit rules

A tag belongs to a group, and a group declares whether it permits one or multiple
values per entry. Entry/tag assignments form relationships, not comma-separated
strings. Enforce selection rules on the server and with appropriate database
constraints or transactions.

Built-in groups use stable internal identifiers independently of display names.
Media type is a canonical domain value, even when exposed through a built-in tag
group; avoid separately editable copies of the same fact. User-created groups
provide flexible organization without changing the meaning of built-in fields.

### Keep sortable and calculable values typed

Store dates, ratings, episode/page counts, and progress as typed fields rather
than free-text tags. Define units, valid ranges, and how unknown values are
represented. For example, an unknown episode count is different from zero.

Use explicit columns or related tables for common structured fields. If custom
fields are introduced, define their type and validation rules and store values
accordingly. JSONB is suitable for provider payloads and layout configuration;
values used in filtering or calculations still need validated types and a query
strategy.

### Separate layout from content

Store default layouts by media type and entry-specific layout overrides
separately from entry metadata. Give sections stable identifiers so visibility,
future reordering, and future personal sections can evolve without overwriting
content. Keep the initial implementation inside `entries`; extract a dedicated
layout module only when its complexity justifies one.

### Save smart collections as queries

Store a validated filter definition and sort settings for each smart collection.
Evaluate it against the current library so results update automatically. Reuse
entry records across collections. Manual ranked lists can later use a separate
membership table with position values.

### Identify imports by source identifiers

Associate provider identifiers with entries so search results can indicate titles
already saved. Do not rely on title text alone for duplicate detection. Allow
manual entries without a provider identifier and keep uncertain cross-provider
matches reviewable.

### Back up the whole customizable library

Use a versioned backup format covering entries, imported metadata, overrides,
tag groups, tags, assignments, collection queries, layouts, and preferences.
Include locally stored covers or a defined way to restore them when uploads are
implemented. Validate backups before restoring and apply database changes
transactionally.

## Adding code incrementally

Add unit tests beside the behavior they cover when implementing features.
Introduce integration and end-to-end test folders once their tools and workflows
are selected. Keep future statistics, ranked lists, social features, and sharing
out of the initial module tree until they are being built.

The first implemented feature is external catalog search: React/Vite talks to
Express, which validates requests and calls TMDB, Tenrai, IGDB, or Open Library provider adapters. Shared types
define the provider capabilities and normalized search results. Vitest covers
the adapters, API routes, and React interactions. Combined searches run as
independent provider/type groups with isolated pagination and errors. Saved library
entries use SQLite with a unique provider/media-type/source-ID constraint. Import
snapshots and personal statuses are separate, and soft removal retains the record
for restoration. See [external search](external-search.md) and [the library guide](library.md)
for setup and extension instructions.

Manual creation at `/entry` saves common title/description fields plus typed,
validated media details in SQLite's `details_json` column. Shared field definitions
drive the form, server checks, and details display. The reserved `manual` source
and a unique request UUID make retries idempotent without matching by title.
Manual records share library status, search, filtering, and removal/restoration
with catalog imports. See [manual entries](manual-entries.md).
