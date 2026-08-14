import type {
  GameVisibility,
  OwnedGameDto,
  UploadedReleaseSummaryDto,
  UserDto,
} from "digipology-protocol/http";
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

export interface UploadedGameRecord {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  ownerUserId: string;
  creatorHandle: string;
  visibility: GameVisibility;
  latestReleaseId: string;
  totalPlays: number;
  coverVersion: number | null;
}

export interface GameMetrics {
  currentPlayers: number;
  totalPlays: number;
}

export interface UploadedReleaseRecord extends UploadedReleaseSummaryDto {
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  minPlayers: number;
  maxPlayers: number;
  manifestHash: string;
  bundleKey: string;
  status: string;
}

interface GameRow {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  min_players: number;
  max_players: number;
  owner_user_id: string;
  owner_name: string;
  visibility: GameVisibility;
  latest_release_id: string;
  total_plays: number;
  cover_version: number | null;
}

interface GameMetricsRow {
  slug: string;
  current_players: number;
  total_plays: number;
}

interface ReleaseRow {
  id: string;
  game_id: string;
  game_slug: string;
  game_title: string;
  min_players: number;
  max_players: number;
  release_number: number;
  kernel_version: number;
  lua_api_version: number;
  manifest_hash: string;
  bundle_key: string;
  status: string;
  created_at: number;
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

  async increment(key: string, windowStart: number, expiresAt: number, now: number): Promise<number> {
    const statements = await this.db.batch([
      this.db.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(now),
      this.db.prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1
           ELSE 1
         END,
         window_start = excluded.window_start,
         expires_at = ?
       RETURNING count`,
      ).bind(key, windowStart, expiresAt, expiresAt),
    ]);
    const row = statements[1]?.results[0] as { count: number } | undefined;
    if (row === null) throw new Error("D1 rate-limit increment returned no row");
    if (row === undefined) throw new Error("D1 rate-limit increment returned no row");
    return row.count;
  }

  async uploadedSlugExists(slug: string): Promise<boolean> {
    return (await this.db.prepare("SELECT id FROM games WHERE slug = ?").bind(slug).first()) !== null;
  }

  async listPublicUploadedGames(): Promise<UploadedGameRecord[]> {
    const rows = await this.db.prepare(gameSelect(
      "WHERE g.builtin = 0 AND g.visibility = 'public' AND g.latest_release_id IS NOT NULL ORDER BY g.created_at",
    )).all<GameRow>();
    return rows.results.map(gameRecord);
  }

  async listGameMetrics(freshAfter: number): Promise<Map<string, GameMetrics>> {
    const rows = await this.db.prepare(
      `SELECT g.slug, g.total_plays,
              COALESCE(SUM(r.player_count), 0) AS current_players
       FROM games g
       LEFT JOIN rooms_index r
         ON r.game_slug = g.slug
        AND r.ended_at IS NULL
        AND r.last_heartbeat_at IS NOT NULL
        AND r.last_heartbeat_at >= ?
       GROUP BY g.id, g.slug, g.total_plays`,
    ).bind(freshAfter).all<GameMetricsRow>();
    return new Map(rows.results.map((row) => [row.slug, {
      currentPlayers: row.current_players,
      totalPlays: row.total_plays,
    }]));
  }

  async getUploadedGame(slug: string): Promise<UploadedGameRecord | null> {
    const row = await this.db.prepare(gameSelect("WHERE g.builtin = 0 AND g.slug = ?"))
      .bind(slug).first<GameRow>();
    return row === null ? null : gameRecord(row);
  }

  async getUploadedRelease(releaseId: string): Promise<UploadedReleaseRecord | null> {
    const row = await this.db.prepare(releaseSelect("WHERE r.id = ? AND g.builtin = 0"))
      .bind(releaseId).first<ReleaseRow>();
    return row === null ? null : releaseRecord(row);
  }

  async resolveUploadedRelease(reference: string): Promise<UploadedReleaseRecord | null> {
    const direct = await this.getUploadedRelease(reference);
    if (direct !== null) return direct;
    const row = await this.db.prepare(releaseSelect(
      "WHERE g.slug = ? AND r.id = g.latest_release_id AND g.builtin = 0",
    )).bind(reference).first<ReleaseRow>();
    return row === null ? null : releaseRecord(row);
  }

  async listOwnedGames(userId: string): Promise<OwnedGameDto[]> {
    const rows = await this.db.prepare(gameSelect(
      "WHERE g.builtin = 0 AND g.owner_user_id = ? ORDER BY g.updated_at DESC",
    )).bind(userId).all<GameRow>();
    const result: OwnedGameDto[] = [];
    for (const row of rows.results) {
      const releases = await this.db.prepare(
        `SELECT id, release_number, kernel_version, lua_api_version, created_at
         FROM releases WHERE game_id = ? ORDER BY release_number DESC`,
      ).bind(row.id).all<{
        id: string; release_number: number; kernel_version: number; lua_api_version: number; created_at: number;
      }>();
      result.push({
        slug: row.slug,
        title: row.title,
        tagline: row.tagline,
        minPlayers: row.min_players,
        maxPlayers: row.max_players,
        builtin: false,
        creatorHandle: row.owner_name,
        currentPlayers: 0,
        totalPlays: row.total_plays,
        coverVersion: row.cover_version,
        visibility: row.visibility,
        latestReleaseId: row.latest_release_id,
        releases: releases.results.map((release) => ({
          releaseId: release.id,
          releaseNumber: release.release_number,
          kernelVersion: release.kernel_version,
          luaApiVersion: release.lua_api_version,
          createdAt: new Date(release.created_at).toISOString(),
        })),
      });
    }
    return result;
  }

  async createUploadedGame(input: {
    gameId: string; releaseId: string; ownerUserId: string; slug: string; title: string;
    tagline: string; minPlayers: number; maxPlayers: number; manifestHash: string;
    bundleKey: string; now: number;
  }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO games
          (id, slug, title, tagline, min_players, max_players, builtin, latest_release_id,
           created_at, updated_at, owner_user_id, visibility)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'public')`,
      ).bind(
        input.gameId, input.slug, input.title, input.tagline, input.minPlayers, input.maxPlayers,
        input.releaseId, input.now, input.now, input.ownerUserId,
      ),
      this.db.prepare(
        `INSERT INTO releases
          (id, game_id, release_number, kernel_version, lua_api_version, manifest_hash,
           status, created_at, format_version, network_protocol_version, bundle_key)
         VALUES (?, ?, 1, 1, 1, ?, 'ready', ?, 1, 1, ?)`,
      ).bind(input.releaseId, input.gameId, input.manifestHash, input.now, input.bundleKey),
    ]);
  }

  async createUploadedRelease(input: {
    gameId: string; releaseId: string; releaseNumber: number; manifestHash: string;
    bundleKey: string; now: number;
  }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO releases
          (id, game_id, release_number, kernel_version, lua_api_version, manifest_hash,
           status, created_at, format_version, network_protocol_version, bundle_key)
         VALUES (?, ?, ?, 1, 1, ?, 'ready', ?, 1, 1, ?)`,
      ).bind(input.releaseId, input.gameId, input.releaseNumber, input.manifestHash, input.now, input.bundleKey),
      this.db.prepare(
        "UPDATE games SET latest_release_id = ?, updated_at = ? WHERE id = ?",
      ).bind(input.releaseId, input.now, input.gameId),
    ]);
  }

  async updateGameVisibility(
    slug: string,
    ownerUserId: string,
    visibility: GameVisibility,
    now: number,
  ): Promise<boolean> {
    const row = await this.db.prepare(
      `UPDATE games SET visibility = ?, updated_at = ?
       WHERE slug = ? AND owner_user_id = ? AND builtin = 0 RETURNING id`,
    ).bind(visibility, now, slug, ownerUserId).first<{ id: string }>();
    return row !== null;
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

function gameSelect(where: string): string {
  return `SELECT g.id, g.slug, g.title, g.tagline, g.min_players, g.max_players,
    g.owner_user_id, u.name AS owner_name, g.visibility, g.latest_release_id,
    g.total_plays, g.cover_version
    FROM games g JOIN users u ON u.id = g.owner_user_id ${where}`;
}

function releaseSelect(where: string): string {
  return `SELECT r.id, r.game_id, g.slug AS game_slug, g.title AS game_title,
    g.min_players, g.max_players, r.release_number, r.kernel_version, r.lua_api_version,
    r.manifest_hash, r.bundle_key, r.status, r.created_at
    FROM releases r JOIN games g ON g.id = r.game_id ${where}`;
}

function gameRecord(row: GameRow): UploadedGameRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    ownerUserId: row.owner_user_id,
    creatorHandle: row.owner_name,
    visibility: row.visibility,
    latestReleaseId: row.latest_release_id,
    totalPlays: row.total_plays,
    coverVersion: row.cover_version,
  };
}

function releaseRecord(row: ReleaseRow): UploadedReleaseRecord {
  return {
    releaseId: row.id,
    gameId: row.game_id,
    gameSlug: row.game_slug,
    gameTitle: row.game_title,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    releaseNumber: row.release_number,
    kernelVersion: row.kernel_version,
    luaApiVersion: row.lua_api_version,
    manifestHash: row.manifest_hash,
    bundleKey: row.bundle_key,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function defaultName(email: string): string {
  const local = email.slice(0, email.lastIndexOf("@")).replaceAll(/[._-]+/g, " ").trim();
  return Array.from(local || "Player").slice(0, 64).join("");
}
