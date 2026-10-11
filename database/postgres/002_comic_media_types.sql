-- Existing Supabase library: paste this ENTIRE file into SQL Editor and Run
-- before deploying the MangaUpdates update. Existing entries and tags stay intact.
-- Safe to run again; the advisory lock coordinates with Libra's library writes.
DO $libra_comic_types$
BEGIN
PERFORM pg_catalog.pg_advisory_xact_lock(742019, 1);
ALTER TABLE libra.entries DROP CONSTRAINT IF EXISTS entries_media_type_check;
ALTER TABLE libra.entries ADD CONSTRAINT entries_media_type_check
  CHECK (media_type IN ('movie','tv','anime','book','manga','manhwa','manhua','webtoon','game','audiobook','other'));
INSERT INTO libra.schema_migrations (name) VALUES ('002_comic_media_types') ON CONFLICT DO NOTHING;
END;
$libra_comic_types$;
