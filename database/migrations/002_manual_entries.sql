-- Manual fields are stored separately from the common title/description columns.
ALTER TABLE entries ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json));
CREATE UNIQUE INDEX entries_manual_request ON entries (source_id) WHERE provider = 'manual';
