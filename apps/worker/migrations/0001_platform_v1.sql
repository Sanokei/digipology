PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_selector TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_selector_idx ON sessions(token_selector);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  token_selector TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  dev_token_ciphertext TEXT,
  dev_token_iv TEXT
);
CREATE INDEX magic_links_selector_idx ON magic_links(token_selector);
CREATE INDEX magic_links_email_idx ON magic_links(email);

CREATE TABLE oauth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL,
  min_players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  builtin INTEGER NOT NULL CHECK (builtin IN (0, 1)),
  latest_release_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  release_number INTEGER NOT NULL,
  kernel_version INTEGER NOT NULL,
  lua_api_version INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(game_id, release_number)
);

CREATE TABLE rooms_index (
  room_id TEXT PRIMARY KEY,
  join_code TEXT NOT NULL UNIQUE,
  join_code_normalized TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'public')),
  release_id TEXT NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX rooms_public_idx ON rooms_index(visibility, ended_at, created_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
