CREATE TABLE deepseek_usage (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  usd     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
