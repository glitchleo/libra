# Libra
Libra is a personal media library and tracker for the web, designed for both mobile and desktop. It will bring together movies, TV shows, books, novels, manga, manhwa, anime, games, and audiobooks in one easy-to-manage interface.

Using external APIs and publicly available catalogs, Libra will let you search for titles and add them to your library without entering every detail manually. Planned features include progress tracking, custom collections, ratings, notes, and filters to help organize what you’ve watched, read, played, or want to explore next.

## Current implementation

The external search page connects to TMDB (movies and TV series), Tenrai
(anime and manga), IGDB (games), and Open Library (books) through Express. Choose one catalog or **All providers** to
search all four. **All types** searches every supported media type; a specific type
searches only compatible catalogs. Each source/type group has its own results,
pagination, and retry control, so one provider's failure does not hide the others.

Search includes cover cards, ratings, year filters for TMDB, IGDB, and Open Library, adult-content
filters for TMDB and Tenrai, and TMDB's result-language filter. Only filters shared by the active catalogs are shown.
The provider selector is populated by the server so more adapters can be added.

The Library stores entries in local SQLite during development, or Supabase PostgreSQL when deployed. See [the Vercel + Supabase deployment guide](docs/deployment.md) for setup, private access, and moving your existing library. Open a
search result and choose **Add to library**. Set its status to Planned, In progress,
Completed, On hold, or Dropped. Search results indicate titles already saved.
The Library screen supports title/author/tag search, type/status/tag filters, sorting,
pagination, small or large covers, a list with thumbnails, and the same entry details overlay. Removal is reversible by adding
the title again; its saved metadata and status are retained.

Use **Add entry** to create a title missing from the catalogs. Choose any supported
media type, enter a title and optional description, then add fields such as author
and pages, director and runtime, or developer and platforms. Optional cover/reference
URLs, a library status, and tags are supported. Create tags or choose existing ones
before saving. Manual entries are saved in SQLite and their details appear in the
same entry overlay. See [manual entries](docs/manual-entries.md).

**Settings** includes JSON library export/import with validation and an import preview.
Imports keep existing entries by default; an explicit option updates matching entries
from the backup. It also saves display preferences in the browser: layout, sort,
default status, start page, description/rating/tag visibility, and reduced motion.
Mobile layouts include bottom navigation, collapsible library filters, larger touch
controls, and fields that avoid automatic input zoom. See [settings and backups](docs/settings.md).
Search cards open an entry details overlay on the search screen, preserving the
query, filters, results, and current page. It shows the cover, complete available
description or book authors, original title, release date, rating, and catalog source.
Close it with Back to results, the close button, Escape, or a click outside the panel.
An explicit source link inside the overlay opens the original catalog in a new tab.
Book cards show authors and the first publication year, grouping editions under one work.

## Run locally

**Tenrai and Open Library need no API key or account.** Select Tenrai for anime/manga
or Open Library for books. TMDB and IGDB each use their own credentials below.

Tenrai replaces Jikan as the anime/manga provider. For optional higher limits, put
a Tenrai key in `TENRAI_SERVER_KEY` in `server/.env`; leave it blank for public access.
Libra sends it only from Express using `X-Server-Key`. The
[Tenrai setup guide](docs/external-search.md#tenrai-setup) covers keys and limits.

For regular Open Library use, set `OPENLIBRARY_CONTACT_EMAIL` in `server/.env`
to a contact email you want sent in Libra's server-side `User-Agent` header.
It stays out of browser responses. Leave it blank to start with public access.
See [Open Library setup](docs/external-search.md#open-library-setup).

Use Node.js 24 or newer. SQLite uses Node's built-in `node:sqlite` module, so no
separate database installation or npm database driver is needed.

```sh
npm install
```

Copy `server/.env.example` to `server/.env` if it does not already exist. In
PowerShell, use `Copy-Item server/.env.example server/.env` only when the target
file is absent. Add your credentials from [TMDB API settings](https://www.themoviedb.org/settings/api):

```dotenv
TMDB_READ_ACCESS_TOKEN=your_api_read_access_token
TMDB_API_KEY=your_v3_api_key
HOST=127.0.0.1
PORT=3001
```

For TMDB, only one credential is needed. The server prefers `TMDB_READ_ACCESS_TOKEN` and
uses `TMDB_API_KEY` only when the token is empty. Paste the read token without a
`Bearer` prefix. An invalid nonempty token will produce an error even if the API
key is valid. Both fields belong in **server/.env**, never in client code or a
`VITE_` environment variable. Git ignores the real `.env` file.

For **IGDB**, add these to `server/.env` using the Twitch app you authenticated:

```dotenv
IGDB_CLIENT_ID=your_twitch_application_client_id
IGDB_ACCESS_TOKEN=your_access_token
```

Use the `access_token` value from your Twitch JSON response, without `Bearer` or
the surrounding JSON. The Client ID must be from the same Twitch application.
You do not need to paste `token_type`, `expires_in`, or your Client Secret here.
`expires_in` is the token lifetime in seconds from issuance. When it expires,
generate another app token using Twitch's client-credentials flow, replace
`IGDB_ACCESS_TOKEN`, and restart the server. This integration uses the token you
already generated; it does not renew it automatically.

```sh
npm run dev
```

Open [Libra locally](http://127.0.0.1:5173). Vite forwards `/api` requests to
Express at `http://127.0.0.1:3001`. Restart `npm run dev` after changing credentials
and refresh the page. If you change the API port, update the Vite proxy in
`client/vite.config.ts` too. PostgreSQL is not required.

SQLite is created automatically at `database/data/libra.sqlite`, which is ignored
by Git. Set `LIBRARY_DB_PATH` in `server/.env` to use a different file (relative
paths are resolved from `server/`). Migrations run automatically on startup.
Saving persists across browser refreshes and server restarts. Stop Libra before
copying the database file for a consistent backup. This is one personal library
on the local server; accounts and multi-user access are not implemented.
See [the saved library guide](docs/library.md) for the API and storage behavior.

```sh
npm test          # API/adapter and React interaction tests; no real credentials needed
npm run build    # Type checks and production builds for client and server
npm start        # Serve both builds from http://127.0.0.1:3001
```

Run these commands from the repository root. The workspace scripts load the
server's `.env` file. The current server binds to localhost for development.

See [external search integration](docs/external-search.md) for API endpoints,
provider extension instructions, and the TMDB, Tenrai, IGDB, Twitch, and Open Library documentation used.

## Technology stack

- **Client:** React, TypeScript, and Vite.
- **Styling:** CSS Modules for components and regular CSS for global styles.
- **Server:** Node.js, Express, and TypeScript.
- **Database:** Local SQLite, with versioned SQL migrations.
- **Version control:** Git and GitHub.

## Project structure

```text
libra/
├── client/                     # React application built with Vite
│   ├── public/                 # Static files served without processing
│   └── src/
│       ├── app/                # App entry point, routing, providers, and shell
│       ├── api/                # Shared HTTP client and API configuration
│       ├── assets/             # Images, icons, and fonts imported by components
│       ├── components/         # Reusable UI shared across features
│       ├── features/
│       │   ├── library/        # Saved library, grids, lists, filters, and sorting
│       │   ├── entries/        # Details, manual entry, editing, progress, and layouts
│       │   ├── tags/           # Tag groups, tags, and single/multiple selection
│       │   ├── collections/    # Saved filter definitions and smart collections
│       │   ├── search/         # External catalog search and import UI
│       │   ├── settings/       # Themes, display preferences, and defaults
│       │   └── backup/         # Export and restore UI
│       ├── hooks/             # Hooks used by multiple features
│       ├── styles/            # Global CSS, reset, theme variables, and typography
│       └── utils/             # General frontend helpers
├── server/                     # Node.js + Express API
│   └── src/
│       ├── config/            # Environment parsing and server configuration
│       ├── db/                # SQLite connection and migrations
│       ├── middleware/        # Error handling and request middleware
│       ├── modules/
│       │   ├── entries/       # Entry CRUD, library queries, overrides, and layouts
│       │   ├── tags/          # Group definitions, tag assignment, and constraints
│       │   ├── collections/   # Saved queries and collection results
│       │   ├── search/        # Catalog search, import, and duplicate detection
│       │   ├── settings/      # User preferences and organizational defaults
│       │   └── backup/        # Versioned export and transactional restore
│       ├── providers/         # External catalog adapters and normalization
│       └── utils/             # General backend helpers
├── shared/
│   └── src/
│       ├── types/             # Media types, API contracts, and filter definitions
│       └── validation/        # Reusable runtime validation for shared inputs
├── database/
│   ├── migrations/            # Ordered SQLite schema changes
│   └── seeds/                 # Built-in groups, statuses, and development data
└── docs/
    └── architecture.md        # Feature boundaries and data design rules
```

The tree shows feature boundaries, including folders reserved for future work.
Empty folders contain `.gitkeep` files so Git preserves the structure; remove a
placeholder when that folder gains real files. npm workspaces connect `client`,
`server`, and `shared`, with dependency versions recorded in `package-lock.json`.

See [the architecture guide](docs/architecture.md) for naming conventions and how
to keep Libra's customization flexible while its data remains predictable.

