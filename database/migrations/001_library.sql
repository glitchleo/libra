-- Imported catalog metadata and personal library status are stored separately.
CREATE TABLE entries (
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
  catalog_rating REAL CHECK (catalog_rating BETWEEN 0 AND 10),
  catalog_vote_count INTEGER NOT NULL CHECK (catalog_vote_count >= 0),
  external_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','completed','on_hold','dropped')),
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (provider, media_type, source_id)
) STRICT;

CREATE INDEX entries_library_added ON entries (deleted_at, added_at DESC, id);
CREATE INDEX entries_library_type_status ON entries (deleted_at, media_type, status);
