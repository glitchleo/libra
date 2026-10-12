# Libra

A personal media library for movies, TV shows, books, anime, manga, comics, games, and audiobooks. Built with React, TypeScript, Vite, and Express.

- Search TMDB, Tenrai, IGDB, Open Library, and MangaUpdates.
- Save titles, track their status, and organize them with tags and filters.
- Add manual entries and import or export your library as JSON.
- Use SQLite locally or Supabase PostgreSQL on Vercel.

## Run locally

Requires **Node.js 24.x**. Run these commands from the repository root:

```sh
npm install
```

Copy `server/.env.example` to `server/.env` if it does not already exist. TMDB and IGDB need credentials; Tenrai, Open Library, and MangaUpdates work without API keys. See the [search setup guide](docs/external-search.md) for details.

```sh
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). SQLite is created automatically at `database/data/libra.sqlite`.

## Other commands

```sh
npm test         # Run tests
npm run build    # Type-check and build
npm start        # Serve the build at http://127.0.0.1:3001
```

## Documentation

- [Deployment on Vercel + Supabase](docs/deployment.md)
- [Library](docs/library.md) and [manual entries](docs/manual-entries.md)
- [Settings and backups](docs/settings.md)
- [Architecture](docs/architecture.md)
