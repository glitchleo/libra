CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
) STRICT;
CREATE INDEX entry_tags_by_tag ON entry_tags (tag_id, entry_id);

-- Seed once; renamed or deleted defaults stay that way on future starts.
INSERT INTO tags (id, name, name_key) VALUES
  ('77d86a44-77c5-4c25-a0b1-29031f580001', 'Favorites', 'favorites'),
  ('77d86a44-77c5-4c25-a0b1-29031f580002', 'Revisit', 'revisit'),
  ('77d86a44-77c5-4c25-a0b1-29031f580003', 'Recommended', 'recommended'),
  ('77d86a44-77c5-4c25-a0b1-29031f580004', 'Hidden gems', 'hidden gems');
