import type { UserDto } from "digipology-protocol/http";
import type {
  MagicLinkRecord,
  MagicLinkRepository,
  SessionRecord,
  SessionRepository,
} from "./auth";
import type { RateLimitStore } from "./rate-limiter";

interface MagicLinkRow {
  id: string;
  email: string;
  token_selector: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface SessionRow {
  id: string;
  token_selector: string;
  token_hash: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
  user_id: string;
  user_name: string;
  user_email: string;
}

export class D1Repositories implements MagicLinkRepository, SessionRepository, RateLimitStore {
  constructor(readonly db: D1Database) {}

  async insertMagicLink(record: MagicLinkRecord): Promise<void> {
    await this.db.prepare(
      `INSERT INTO magic_links
        (id, email, token_selector, token_hash, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      record.id,
      record.email,
      record.tokenSelector,
      record.tokenHash,
      record.createdAt,
      record.expiresAt,
    ).run();
  }

  async findMagicLinks(tokenSelector: string): Promise<MagicLinkRecord[]> {
    const result = await this.db.prepare(
      `SELECT id, email, token_selector, token_hash, created_at, expires_at, consumed_at
       FROM magic_links WHERE token_selector = ?`,
    ).bind(tokenSelector).all<MagicLinkRow>();
    return result.results.map((row) => ({
      id: row.id,
      email: row.email,
      tokenSelector: row.token_selector,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    }));
  }

  async consumeMagicLink(id: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE magic_links SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
       RETURNING id`,
    ).bind(now, id, now).first<{ id: string }>();
    return result !== null;
  }

  async insertSession(record: SessionRecord): Promise<void> {
    await this.db.prepare(
      `INSERT INTO sessions
        (id, user_id, token_selector, token_hash, created_at, last_used_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      record.id,
      record.user.id,
      record.tokenSelector,
      record.tokenHash,
      record.createdAt,
      record.lastUsedAt,
      record.expiresAt,
    ).run();
  }

  async findSessions(tokenSelector: string): Promise<SessionRecord[]> {
    const result = await this.db.prepare(
      `SELECT s.id, s.token_selector, s.token_hash, s.created_at, s.last_used_at,
              s.expires_at, s.revoked_at, u.id AS user_id, u.name AS user_name,
              u.email AS user_email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_selector = ?`,
    ).bind(tokenSelector).all<SessionRow>();
    return result.results.map((row) => ({
      id: row.id,
      user: { id: row.user_id, name: row.user_name, email: row.user_email },
      tokenSelector: row.token_selector,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }));
  }

  async refreshSession(id: string, now: number, expiresAt: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE sessions SET last_used_at = ?, expires_at = ?
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
       RETURNING id`,
    ).bind(now, expiresAt, id, now).first<{ id: string }>();
    return result !== null;
  }

  async revokeSession(id: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id`,
    ).bind(now, id).first<{ id: string }>();
    return result !== null;
  }

  async increment(key: string, windowStart: number): Promise<number> {
    const row = await this.db.prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1
           ELSE 1
         END,
         window_start = excluded.window_start
       RETURNING count`,
    ).bind(key, windowStart).first<{ count: number }>();
    if (row === null) throw new Error("D1 rate-limit increment returned no row");
    return row.count;
  }

  async findOrCreateUser(email: string, now: number): Promise<UserDto> {
    const id = `user_${crypto.randomUUID()}`;
    const name = defaultName(email);
    await this.db.prepare(
      `INSERT INTO users (id, name, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
    ).bind(id, name, email, now, now).run();
    const user = await this.db.prepare(
      "SELECT id, name, email FROM users WHERE email = ? COLLATE NOCASE",
    ).bind(email).first<{ id: string; name: string; email: string }>();
    if (user === null) throw new Error("D1 user upsert returned no row");
    return user;
  }

  async updateUserName(userId: string, name: string, now: number): Promise<UserDto | null> {
    return this.db.prepare(
      `UPDATE users SET name = ?, updated_at = ? WHERE id = ?
       RETURNING id, name, email`,
    ).bind(name, now, userId).first<UserDto>();
  }
}

function defaultName(email: string): string {
  const local = email.slice(0, email.lastIndexOf("@")).replaceAll(/[._-]+/g, " ").trim();
  return Array.from(local || "Player").slice(0, 64).join("");
}
