PRAGMA foreign_keys = ON;

ALTER TABLE games ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE games ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'unlisted'));

ALTER TABLE releases ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE releases ADD COLUMN network_protocol_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE releases ADD COLUMN bundle_key TEXT;

CREATE INDEX games_visibility_idx ON games(visibility, created_at);
CREATE INDEX games_owner_idx ON games(owner_user_id, updated_at);
CREATE INDEX releases_game_created_idx ON releases(game_id, release_number DESC);

ALTER TABLE rate_limits ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
