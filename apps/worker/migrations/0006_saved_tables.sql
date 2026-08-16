PRAGMA foreign_keys = ON;

ALTER TABLE rooms_index ADD COLUMN creator_user_id TEXT REFERENCES users(id);
ALTER TABLE rooms_index ADD COLUMN resumed_from_save_id TEXT;

CREATE TABLE saved_tables (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  release_id TEXT NOT NULL,
  game_slug TEXT NOT NULL,
  source_room_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  requires_scripts INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX saved_tables_owner_idx
  ON saved_tables(owner_user_id, deleted_at, created_at);
