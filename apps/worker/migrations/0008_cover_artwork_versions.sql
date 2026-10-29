CREATE TABLE game_covers (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  asset_key TEXT NOT NULL,
  fingerprint TEXT,
  info_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, version)
);
CREATE INDEX game_covers_fingerprint ON game_covers(game_id, fingerprint);

-- Preserve the currently published legacy object before new uploads use immutable keys.
INSERT INTO game_covers(game_id, version, asset_key, created_at)
SELECT id, cover_version, 'covers/' || id, updated_at FROM games
WHERE builtin = 0 AND cover_version IS NOT NULL;
