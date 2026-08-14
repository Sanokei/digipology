PRAGMA foreign_keys = ON;

ALTER TABLE rooms_index ADD COLUMN origin TEXT NOT NULL DEFAULT 'hosted'
  CHECK (origin IN ('hosted', 'quickplay'));
ALTER TABLE rooms_index ADD COLUMN last_heartbeat_at INTEGER;
ALTER TABLE rooms_index ADD COLUMN game_slug TEXT;

ALTER TABLE games ADD COLUMN total_plays INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN cover_version INTEGER;

INSERT OR IGNORE INTO games
  (id, slug, title, tagline, min_players, max_players, builtin, latest_release_id,
   created_at, updated_at, owner_user_id, visibility, total_plays, cover_version)
VALUES
  ('game_builtin_first_deal', 'first-deal', 'First Deal',
   'Shuffle, deal, draw, flip, and move a full deck together.', 2, 4, 1,
   'builtin_first_deal_1', 0, 0, NULL, 'public', 0, 1),
  ('game_builtin_dice_dash', 'dice-dash', 'Dice Dash',
   'Roll together, keep your score, and race to the finish.', 2, 4, 1,
   'builtin_dice_dash_2', 0, 0, NULL, 'public', 0, 1);

UPDATE games SET cover_version = COALESCE(cover_version, 1)
WHERE slug IN ('first-deal', 'dice-dash') AND builtin = 1;

UPDATE rooms_index
SET game_slug = (
  SELECT g.slug
  FROM releases r JOIN games g ON g.id = r.game_id
  WHERE r.id = rooms_index.release_id
)
WHERE game_slug IS NULL;

UPDATE rooms_index SET game_slug = 'first-deal'
WHERE game_slug IS NULL AND release_id = 'builtin_first_deal_1';
UPDATE rooms_index SET game_slug = 'dice-dash'
WHERE game_slug IS NULL AND release_id IN ('builtin_dice_dash_1', 'builtin_dice_dash_2');

CREATE INDEX rooms_matchmaking_idx
  ON rooms_index(release_id, visibility, ended_at, last_heartbeat_at, player_count);
CREATE INDEX rooms_game_liveness_idx
  ON rooms_index(game_slug, ended_at, last_heartbeat_at);
