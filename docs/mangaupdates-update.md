# Deploy the MangaUpdates update

Use your existing Vercel project and Supabase database. MangaUpdates searches
use its public API and need no API key or new environment variable.

## 1. Update Supabase first

1. Export a library backup from the deployed app's **Settings → Export JSON**.
2. In the Supabase project connected to Libra, open **SQL Editor → New query**.
3. Copy the entire contents of
   [`database/postgres/002_comic_media_types.sql`](../database/postgres/002_comic_media_types.sql)
   into the editor and click **Run**. Use the `postgres` role if a role selector appears.
4. Expect **Success. No rows returned**. This replaces only the allowed-media-type
   constraint, adding `manhua` and `webtoon`; it preserves entries, statuses and tags.
   It is safe to rerun. The old deployed app continues to work after this change.

Do not run the files under `database/migrations/` in Supabase: they are for local
SQLite and run automatically when the local server starts. For a first deployment,
run the full `database/postgres/001_library.sql` setup instead; it includes these types.

## 2. Check Vercel settings

Open **Vercel → Libra → Settings → Build and Deployment**. Keep these values:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root; leave empty |
| Framework Preset | Other |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `client/dist` |
| Node.js Version | 24.x |

The repository's `vercel.json` already supplies the commands, output and API routing.
In **Settings → Environment Variables**, keep your existing `DATABASE_URL`,
`LIBRA_PASSWORD`, TMDB and IGDB credentials. `DATABASE_URL` must remain the Supabase
transaction-pooler URI on port 6543. Preview deployments need variables for their
own environment and the same schema upgrade in their database.

## 3. Upload the update through GitHub

In GitHub Desktop, open **libra**, review all changed files, commit with a message
such as **Add MangaUpdates and improve search and tags**, then click **Push origin**.
Include the client, server, shared types, both database migrations, and docs together.
Do not upload `node_modules`, build folders, database files, or `server/.env`.

Alternatively, run from the repository root, one command at a time:

```sh
git add client server shared database docs README.md
git commit -m "Add MangaUpdates and improve search and tags"
git push
```

Vercel normally deploys a push to its connected production branch automatically.
Open **Deployments**, select the deployment for your new commit, and wait for
**Ready**. If an environment variable changed, redeploy that newest commit;
redeploying an older deployment uses its older code. Visit your stable production
domain and refresh the app on your phone and computer.

## 4. Verify on the deployed app

1. Sign in, select **MangaUpdates**, choose **Manhwa**, and search **Solo Leveling**.
   Try **Manhua** and **Webtoons** too. Open a result and its source link.
2. Choose **Completed**, add the title, then open another unsaved title: its status
   should start at **Completed**. Refresh the page: it should return to your saved
   Settings default (normally **Planned**).
3. Tap several entry tags. Selections should update immediately and save together
   about five seconds after the first tap. Close the entry during that window;
   the queue should still save. After it finishes, refresh and check the tags remain.
4. On your phone, focus a search containing text: it should select the whole query.
   On your computer, **Ctrl+K** (or **Cmd+K**) opens and focuses search. **/** works
   when you are outside a text field. Entry dialogs retain their keyboard controls.
5. Confirm an existing movie, anime, game and book search still works. Check Library,
   filters, manual entries and **Export JSON**. Open `/api/health` to confirm the API
   responds with `{"status":"ok"}`.

If adding a manhua/webtoon fails with a database constraint error, run step 1 in
the database actually used by Vercel's `DATABASE_URL`. If an existing provider
reports a credential error, correct its server-side Vercel variable and redeploy.
MangaUpdates rate-limit errors can be retried after the displayed delay.

References: [MangaUpdates API](https://api.mangaupdates.com/),
[Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json),
[Vercel environment variables](https://vercel.com/docs/environment-variables),
[Supabase serverless connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
