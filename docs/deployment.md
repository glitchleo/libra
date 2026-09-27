# Deploy Libra to Vercel + Supabase

Libra deploys as one Vercel project: Vite's website in `client/dist`, plus the Express API through `api/index.ts`. Supabase stores entries, media details, statuses, tags, and assignments in PostgreSQL. Local development still uses SQLite when `DATABASE_URL` is empty. This is one personal library protected by a private password, not a multi-user service.

Connecting the Vercel/Supabase integration alone does not create Libra's tables or move your local library. Complete these steps once.

## What the reported errors mean

- `npm warn install-scripts ... esbuild` is a warning, not evidence that the deployment failed. The pasted excerpt ends at `vite build`. The final lines of the build log contain the actual failure, if there is one.
- A build starting directly with `@libra/client` suggests either **Root Directory = client** or a client-only Build Command. This project must deploy from the repository root so Vercel sees both `api/index.ts` and `vercel.json`. The expected build starts with `libra@0.1.0 build`, runs type checking, then builds both client and server.
- `relation "schema_migrations" does not exist` means that statement could not see the migration table. The earlier setup depended on a shared transaction/search path. The updated SQL uses one atomic `DO` statement and explicitly names every table under `libra`, making it independent of the editor's selected schema. Run the entire updated file, not just its tag-seeding section.
- TypeScript errors saying validated fields such as `name` or `releaseDate` are optional come from the function compiler losing strict mode. Vercel's Node builder applies defaults before resolving inherited compiler settings; when `module` is only inherited, that step can set `strict: false`. The root `tsconfig.json` explicitly sets `module`, `moduleResolution`, `strict`, and `strictNullChecks` to prevent it. Keep those settings directly in that file. The normal build also checks this root config. Push both `tsconfig.json` and `package.json`, then redeploy the new commit; database changes are not needed for this error.
- `ERR_MODULE_NOT_FOUND` pointing to `@libra/shared/src/types/library.ts` is an API packaging error. The old shared package exported TypeScript source files, but Vercel shipped them as JavaScript. The shared package now exports compiled JavaScript from `shared/dist`, with separate type declarations. The root build compiles it before checking and building the apps. Push `package.json`, `shared/package.json`, and `shared/tsconfig.json` together, then deploy the new commit. Do not upload `dist` or change Supabase tables or credentials to fix this error.
- `400` errors with `INVALID_SEARCH` and `INVALID_LIBRARY_QUERY`, while `/api/entries/index` works and manual saves return `201`, can come from the API rewrite. A named `/api/:path*` capture becomes an extra `path` query parameter, which strict filter validation rejects. The rewrite now uses the unnamed `/api/(.*)` capture so the original search and library filters reach the API unchanged. Deploy the corrected `vercel.json`. A successful manual save is already stored; check the library after redeploying before creating the same entry again.

## 1. Prepare Supabase

1. Open [the Supabase dashboard](https://supabase.com/dashboard), sign in, and click your existing project. Use the project connected to Vercel. Wait until its database is running; resume it first if it is paused.
2. Click **SQL Editor** in the project's left sidebar.
3. Click **New query** (or the **+** button beside the SQL tabs). Start a fresh query instead of appending to the failed one.
4. Open [the corrected PostgreSQL setup file](../database/postgres/001_library.sql) on your computer. Copy all its contents. Do not use files inside `database/migrations/`: those are for SQLite.
5. Click inside the blank SQL editor and paste. The script starts with comments followed by `DO $libra_setup$` and ends with `$libra_setup$;`. Include both ends. If a database role selector is shown, use **postgres**.
6. Click in the editor without leaving a partial selection, then click **Run**. A successful setup may say **Success. No rows returned**; that is expected because it creates tables rather than selecting data.
7. Open another **New query**, paste the following, and click **Run**:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'libra'
ORDER BY table_name;
```

Expect four names: `entries`, `entry_tags`, `schema_migrations`, and `tags`.

8. To view them visually, click **Table Editor** in the left sidebar and select **libra** in the schema dropdown (which may initially say **public**). Do not create replacement tables in `public`.

The script preserves existing data when rerun. No Supabase Auth account, browser API key, service-role key, or Data API policy is needed for this app: its server connects using the database owner's PostgreSQL connection. Keep `libra` out of the Data API's exposed schemas. RLS remains enabled.

### Copy the database connection

1. In the same Supabase project, click **Connect** at the top of the page.
2. Open the **Connection string** view if the dialog has tabs. Select **URI** as the format and **Transaction pooler** as the method.
3. Copy the connection URI. The pooler port should be **6543**, and the username commonly starts with `postgres.` followed by your project reference.
4. Replace `[YOUR-PASSWORD]` with the database password you chose when creating the Supabase project. Remove the square brackets as well. This is the database password, not your Supabase website sign-in password and not the Libra password you will create below.
5. If the password contains reserved URL characters, percent-encode the password portion: for example `@` → `%40`, `#` → `%23`, `%` → `%25`, `/` → `%2F`, `?` → `%3F`. Do not encode the entire URI. Do not enter your password into a third-party online encoder.
6. Keep the completed URI ready for the next steps; enter it only in Vercel's secret environment-variable field.

The shape is `postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:6543/postgres`. Use your dashboard's real hostname and username, not this placeholder example. If you do not know the database password, use the reset-password option linked from Supabase's connection/database settings; then update every application that uses that database.

## 2. Configure Vercel

1. Open [the Vercel dashboard](https://vercel.com/dashboard) and click your existing **Libra** project. You do not need another project or a paid plan for personal use within the free limits.
2. Click **Settings**, then **Build and Deployment** in the settings sidebar.
3. Find **Root Directory**, remove `client` or any other subdirectory, and select the repository root. The saved field should be empty. Click **Save** for that section. Root here means the folder containing `client`, `server`, `shared`, `api`, and `vercel.json` together.
4. Find **Framework Settings / Build & Development Settings** on that page. Choose **Other** for Framework Preset. Set the following values, turning on each **Override** switch if needed to edit its field, then click **Save**:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (leave empty, not `client` or `server`) |
| Framework Preset | Other |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `client/dist` |
| Node.js Version | 24.x |

5. Find **Node.js Version**, select **24.x**, and save. The repository's `engines` setting also pins 24.x.

The root `vercel.json` supplies these settings and routes `/api/*` to Express. If Vercel reports that a value is overridden by `vercel.json`, that is expected as long as the effective value matches the table. Explicitly including development dependencies ensures TypeScript, Vite, and esbuild are available during the build. You do not need to create a `public` directory or upload `dist` manually.

### Add the environment variables

1. Still inside the Vercel project, open **Settings → Environment Variables**.
2. Click **Add Environment Variable** (or **Add New**).
3. Enter **Key**: `DATABASE_URL`. In **Value**, paste the complete Supabase URI prepared above, without surrounding quotes.
4. Select **Production** as its environment, then click **Save**.
5. Add another variable: **Key** `LIBRA_PASSWORD`, **Value** a unique private passphrase of 16–256 characters. Choose **Production**, then save. This is the password you will enter on the Libra website.
6. Repeat for the provider credentials below. If a key already exists, open its **… → Edit** action and correct it rather than adding a competing duplicate. Leave the value out of screenshots and public messages.

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

You can add only `DATABASE_URL` and `LIBRA_PASSWORD` initially to use manual entries and uncredentialed catalogs. Add TMDB and IGDB credentials to enable those searches. Variables named `SUPABASE_URL`, `POSTGRES_URL`, or a Supabase API key do not automatically replace `DATABASE_URL` in this app.

IGDB access tokens expire. Renew yours with Twitch when necessary, update `IGDB_ACCESS_TOKEN`, and redeploy.

### Push the corrected files and deploy

Vercel reads the GitHub commit, not unsaved or unpushed files on your computer. Commit all files belonging to a fix together, and verify that the deployment uses that commit. The routing correction below needs a new commit after `e931b93`.

1. Open a terminal in this repository's top-level `libra` folder and run the following commands, one at a time:

```sh
git add vercel.json package.json package-lock.json server/src/vercel-routing.test.ts docs/deployment.md
git commit -m "Fix Vercel API query routing"
git push
```

If you use GitHub Desktop, the equivalent is: open the **libra** repository, review these files under **Changes**, enter the commit message, click **Commit to main**, then **Push origin**.

2. Back in Vercel, open **Deployments**. A push to the linked production branch normally creates a new deployment automatically. Select the newest deployment for **main** and verify its commit matches the new one.
3. If you need to redeploy after changing settings, use **… → Redeploy** on that newest deployment. Choose **Production**, turn off **Use existing Build Cache** for this retry if that option appears, then click **Redeploy**. Redeploying an older row uses that older commit.
4. Expand **Build Logs**. Expect the root `libra@0.1.0 build`, a shared package build, type checks, a client build, and a server build. The `@libra/client` line is normal when it appears after the root build.
5. Wait for status **Ready**. Then use **Visit** or the production domain shown on the project overview. If the deployment is **Error**, scroll to the very bottom of Build Logs: copy the final error and preceding lines, not just the install warning.

## 3. Move your current library

1. Run `npm run dev` locally with `DATABASE_URL` empty in `server/.env`. Open the local app, click **Settings** in the navbar, then **Export JSON** under **Library backups**. Save the downloaded file.
2. Open the deployed production URL, type your `LIBRA_PASSWORD`, and click **Open my library**. The cloud library starts empty until you import or add entries.
3. Click **Settings**, scroll to **Import a backup**, click **Backup file**, and choose the downloaded JSON. Keep **Keep my existing entry and tags**, click **Preview import**, review the counts, then click **Import into library**. Wait for the completion message.
4. Check the entries and tags. Local SQLite stays intact; nothing is automatically uploaded or deleted.

Hosted JSON backups have a **4 MB** limit to fit Vercel's 4.5 MB request/response limit. Local backups retain the 25 MB limit. Larger backups need a separate migration approach; do not arbitrarily split JSON in a text editor.

## 4. Use it on your phone

Open the stable production URL (`https://your-project.vercel.app`), sign in, and optionally choose **Add to Home Screen**. Your PC and dev server can be off. Internet access is required. Each successful library change commits to Supabase and is visible on another device after refresh. Covers remain image URLs. Display preferences remain per-browser.

Use the production URL listed under Vercel's project **Settings → Domains**. `127.0.0.1:5173` refers to the device itself and will not reach your PC from your phone. Bookmark the production domain on your phone and computer. To verify saving, create a tag on one device, refresh the Library on the other, and check that tag is available there.

Sessions last 30 days and use an HttpOnly, Secure, SameSite cookie in production. **Settings → Sign out on this device** clears that session. Changing `LIBRA_PASSWORD` and redeploying invalidates old sessions on the new deployment. Supabase Auth signups are not used.

Supabase Free may pause projects with low activity over a 7-day period. Resume them in the dashboard, or use a plan without inactivity pausing if you need access without that interruption. Hosting still has outages and usage limits; keep periodic JSON backups.

## Verify deployment

- Open `/library` directly: sign-in should appear, then the library after signing in.
- `/api/health` should return JSON with `status: "ok"`. This checks the API process, not the database.
- `/api/auth` should return JSON with `required: true` and your current authentication state. A 500 here means the API could not initialize; check Vercel's runtime logs, even if the build was successful.
- Create a tag or entry, refresh, then open the production URL on another device. The saved data should be there.
- In Supabase's Table Editor, select the `libra` schema to inspect `entries`, `tags`, and `entry_tags`.
- If the website loads but cannot connect, check Vercel function logs and required environment variables. Redeploy after changing them.
- If sign-in works but saving fails, check the SQL ran in the project matching `DATABASE_URL`, the database password is correct, and the database is not paused.

References: [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [function limits](https://vercel.com/docs/functions/limitations), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase availability](https://supabase.com/docs/guides/deployment/going-into-prod).
