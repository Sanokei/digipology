PRAGMA foreign_keys = ON;

-- Existing rooms are deliberately conservative: without a persisted lobby
-- phase they may already contain gameplay and must not enter matchmaking.
ALTER TABLE rooms_index ADD COLUMN joinable INTEGER NOT NULL DEFAULT 0
  CHECK (joinable IN (0, 1));

CREATE INDEX rooms_matchmaking_joinable_idx
  ON rooms_index(release_id, visibility, ended_at, joinable,
                 last_heartbeat_at, player_count);
