-- SQLite cannot alter a CHECK constraint. Save relationships before replacing
-- entries so ON DELETE CASCADE cannot remove a user's tags during the rebuild.
CREATE TEMP TABLE comic_entry_tags_backup AS SELECT entry_id, tag_id FROM entry_tags;
DROP TABLE entry_tags;

CREATE TABLE entries_comic_types (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv','anime','book','manga','manhwa','manhua','webtoon','game','audiobook','other')),
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
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  UNIQUE (provider, media_type, source_id)
) STRICT;

INSERT INTO entries_comic_types SELECT * FROM entries;
DROP TABLE entries;
ALTER TABLE entries_comic_types RENAME TO entries;
CREATE INDEX entries_library_added ON entries (deleted_at, added_at DESC, id);
CREATE INDEX entries_library_type_status ON entries (deleted_at, media_type, status);
CREATE UNIQUE INDEX entries_manual_request ON entries (source_id) WHERE provider = 'manual';

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
) STRICT;
CREATE INDEX entry_tags_by_tag ON entry_tags (tag_id, entry_id);
INSERT INTO entry_tags SELECT entry_id, tag_id FROM comic_entry_tags_backup;
DROP TABLE comic_entry_tags_backup;
