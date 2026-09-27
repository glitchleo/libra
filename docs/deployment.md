# Deploy Libra to Vercel + Supabase

Libra deploys as one Vercel project: Vite's website in `client/dist`, plus the Express API through `api/index.ts`. Supabase stores entries, media details, statuses, tags, and assignments in PostgreSQL. Local development still uses SQLite when `DATABASE_URL` is empty. This is one personal library protected by a private password, not a multi-user service.

Connecting the Vercel/Supabase integration alone does not create Libra's tables or move your local library. Complete these steps once.

## 1. Prepare Supabase

1. Open **SQL Editor → New query** in your Supabase project.
2. Paste and run the entire `database/postgres/001_library.sql` file. It creates the private `libra` schema, tables, indexes, and default tags. Rerunning it preserves data and deleted defaults.
3. Open **Connect → Transaction pooler** and copy the PostgreSQL URI using port **6543**. Replace `[YOUR-PASSWORD]` with the database password. Percent-encode reserved characters in the password. Copy the hostname and username from the dashboard.
4. No Supabase browser API key or service-role key is needed. The server connects directly using the PostgreSQL owner connection. Keep `libra` out of the Data API's exposed schemas. Its tables also have RLS enabled with no public policies.

## 2. Configure Vercel

Push these changes to the linked Git repository, including `vercel.json`, `api/`, `database/postgres/`, and `package-lock.json`.

In **Project Settings → Build and Deployment**:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (leave empty, not `client` or `server`) |
| Framework Preset | Other |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `client/dist` |
| Node.js Version | 24.x |

`vercel.json` supplies the build/output settings and routes `/api/*` to Express. Direct links such as `/library` work too. Remove any old `public` output override if the dashboard still shows it. The cloud API refuses to start without the database and password instead of silently using SQLite.

In **Project Settings → Environment Variables**, add these for **Production**, then redeploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler URI from step 1 |
| `LIBRA_PASSWORD` | A unique private passphrase, at least 16 characters, for signing in on each device |
| `TMDB_READ_ACCESS_TOKEN` | Existing TMDB API read token; alternatively use `TMDB_API_KEY` |
| `IGDB_CLIENT_ID` | Twitch application's client ID |
| `IGDB_ACCESS_TOKEN` | Current Twitch app access token, without `Bearer` |
| `TENRAI_SERVER_KEY` | Optional, if you have one |
| `OPENLIBRARY_CONTACT_EMAIL` | Recommended contact email for Open Library |

An integration may already supply connection variables. Make sure the exact name `DATABASE_URL` points to the **transaction pooler**, not just a Supabase project URL. Do not commit secrets or prefix them with `VITE_`. `server/.env` stays local. Preview deployments need their own variables; a separate Supabase project keeps preview/test changes out of your real library.

IGDB access tokens expire. Renew yours with Twitch when necessary, update `IGDB_ACCESS_TOKEN`, and redeploy.

## 3. Move your current library

1. Run the local app with `DATABASE_URL` empty. Open **Settings → Export JSON**.
2. Open the deployed Vercel URL and enter `LIBRA_PASSWORD`.
3. Open **Settings → Import a backup**, select the JSON file, preview, and import. **Keep my existing entry and tags** is suitable for an initial migration or a safe repeat.
4. Check the entries and tags. Local SQLite stays intact; nothing is automatically uploaded or deleted.

Hosted JSON backups have a **4 MB** limit to fit Vercel's 4.5 MB request/response limit. Local backups retain the 25 MB limit. Larger backups need a separate migration approach; do not arbitrarily split JSON in a text editor.

## 4. Use it on your phone

Open the stable production URL (`https://your-project.vercel.app`), sign in, and optionally choose **Add to Home Screen**. Your PC and dev server can be off. Internet access is required. Each successful library change commits to Supabase and is visible on another device after refresh. Covers remain image URLs. Display preferences remain per-browser.

Sessions last 30 days and use an HttpOnly, Secure, SameSite cookie in production. **Settings → Sign out on this device** clears that session. Changing `LIBRA_PASSWORD` and redeploying invalidates old sessions on the new deployment. Supabase Auth signups are not used.

Supabase Free may pause projects with low activity over a 7-day period. Resume them in the dashboard, or use a plan without inactivity pausing if you need access without that interruption. Hosting still has outages and usage limits; keep periodic JSON backups.

## Verify deployment

- Open `/library` directly: sign-in should appear, then the library after signing in.
- `/api/health` should return JSON with `status: "ok"`. This checks the API process, not the database.
- Create a tag or entry, refresh, then open the production URL on another device. The saved data should be there.
- In Supabase's Table Editor, select the `libra` schema to inspect `entries`, `tags`, and `entry_tags`.
- If the website loads but cannot connect, check Vercel function logs and required environment variables. Redeploy after changing them.
- If sign-in works but saving fails, check the SQL ran in the project matching `DATABASE_URL`, the database password is correct, and the database is not paused.

References: [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [function limits](https://vercel.com/docs/functions/limitations), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase availability](https://supabase.com/docs/guides/deployment/going-into-prod).
