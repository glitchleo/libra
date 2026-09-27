-- Copy this ENTIRE file into a new Supabase SQL Editor query and click Run.
-- One atomic statement; independent of the editor's schema/search_path.
-- Safe to run again: existing entries and tags are preserved.
DO $libra_setup$
BEGIN
PERFORM pg_catalog.pg_advisory_xact_lock(742019, 1);
CREATE SCHEMA IF NOT EXISTS libra;
REVOKE ALL ON SCHEMA libra FROM PUBLIC;
CREATE TABLE IF NOT EXISTS libra.schema_migrations (name TEXT PRIMARY KEY);
-- Imported catalog metadata and personal library status are stored separately.
CREATE TABLE IF NOT EXISTS libra.entries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv','anime','book','manga','manhwa','game','audiobook','other')),
  provider_name TEXT NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT NOT NULL,
  overview TEXT NOT NULL,
  release_date TEXT,
  poster_url TEXT,
  catalog_rating DOUBLE PRECISION CHECK (catalog_rating BETWEEN 0 AND 10),
  catalog_vote_count INTEGER NOT NULL CHECK (catalog_vote_count >= 0),
  external_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','completed','on_hold','dropped')),
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (provider, media_type, source_id)
);

CREATE INDEX IF NOT EXISTS entries_library_added ON libra.entries (deleted_at, added_at DESC, id);
CREATE INDEX IF NOT EXISTS entries_library_type_status ON libra.entries (deleted_at, media_type, status);

ALTER TABLE libra.entries ADD COLUMN IF NOT EXISTS details_json TEXT NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details_json::jsonb) = 'object');
CREATE UNIQUE INDEX IF NOT EXISTS entries_manual_request ON libra.entries (source_id) WHERE provider = 'manual';
CREATE TABLE IF NOT EXISTS libra.tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS libra.entry_tags (
  entry_id TEXT NOT NULL REFERENCES libra.entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES libra.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS entry_tags_by_tag ON libra.entry_tags (tag_id, entry_id);


IF NOT EXISTS (SELECT 1 FROM libra.schema_migrations WHERE name = '001_library') THEN
INSERT INTO libra.tags (id, name, name_key) VALUES
  ('77d86a44-77c5-4c25-a0b1-29031f580001', 'Favorites', 'favorites'),
  ('77d86a44-77c5-4c25-a0b1-29031f580002', 'Revisit', 'revisit'),
  ('77d86a44-77c5-4c25-a0b1-29031f580003', 'Recommended', 'recommended'),
  ('77d86a44-77c5-4c25-a0b1-29031f580004', 'Hidden gems', 'hidden gems')
ON CONFLICT DO NOTHING;

INSERT INTO libra.schema_migrations (name) VALUES ('001_library');
END IF;
REVOKE ALL ON ALL TABLES IN SCHEMA libra FROM PUBLIC;
ALTER TABLE libra.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE libra.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE libra.entry_tags ENABLE ROW LEVEL SECURITY;
END;
$libra_setup$;

