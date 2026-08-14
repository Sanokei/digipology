import type {
  CreateRoomResponse,
  GameResponse,
  GamesResponse,
  JoinRoomResponse,
  MeResponse,
  PublicRoomsResponse,
  UserResponse,
} from "digipology-protocol/http";
import {
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  validateRequestMagicLinkRequest,
  validateUpdateMeRequest,
} from "digipology-protocol/http";
import {
  authenticateSession,
  consumeMagicLink,
  createMagicLink,
  createSession,
  revokeSessionToken,
  type AuthenticatedSession,
} from "./auth";
import { builtinCatalog, gameSummary, releaseSummary } from "./catalog";
import {
  clearSessionCookie,
  parseCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from "./cookies";
import { decryptDevelopmentToken, encryptDevelopmentToken, sha256Hex } from "./crypto";
import { D1Repositories } from "./d1-repositories";
import { CloudflareEmailSender, DevelopmentEmailSender, type EmailSender } from "./email";
import { FixedWindowRateLimiter } from "./rate-limiter";
import { generateJoinCode, isValidJoinCode, normalizeJoinCode } from "./random";

const HTTP_BODY_LIMIT = 4 * 1024;
const MAGIC_EMAIL_LIMIT = 3;
const MAGIC_IP_LIMIT = 10;
const MAGIC_RATE_WINDOW_MS = 15 * 60 * 1000;
const JOIN_IP_LIMIT = 30;
const JOIN_RATE_WINDOW_MS = 60 * 1000;
// Must match CSRF_HEADER in apps/web/src/api/client.ts (the SPA already on main).
const CUSTOM_HEADER = "X-Digipology-CSRF";

interface RoomIndexLookupRow {
  room_id: string;
}

interface PublicRoomRow {
  join_code: string;
  release_id: string;
  player_count: number;
  max_players: number;
  created_at: number;
}

interface DevelopmentMagicLinkRow {
  dev_token_ciphertext: string;
  dev_token_iv: string;
}

export async function handlePlatformRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && url.pathname.startsWith("/api/") && !isCsrfSafe(request)) {
    return jsonError(403, "csrf_rejected", `Same-origin requests must include ${CUSTOM_HEADER}: 1`);
  }

  const repositories = new D1Repositories(env.DB);
  const now = Date.now();

  if (request.method === "POST" && url.pathname === "/api/auth/request-link") {
    const body = await readJson(request);
    const parsed = validateRequestMagicLinkRequest(body);
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    const email = parsed.value.email.toLowerCase();
    const ip = clientIp(request);
    const [emailHash, ipHash] = await Promise.all([sha256Hex(email), sha256Hex(ip)]);
    const limiter = new FixedWindowRateLimiter(repositories, MAGIC_EMAIL_LIMIT, MAGIC_RATE_WINDOW_MS);
    const ipLimiter = new FixedWindowRateLimiter(repositories, MAGIC_IP_LIMIT, MAGIC_RATE_WINDOW_MS);
    const [emailRate, ipRate] = await Promise.all([
      limiter.consume(`magic:email:${emailHash}`, now),
      ipLimiter.consume(`magic:ip:${ipHash}`, now),
    ]);
    if (!emailRate.allowed || !ipRate.allowed) {
      return jsonError(
        429,
        "rate_limited",
        "Too many magic-link requests; try again later",
        { "Retry-After": String(Math.max(emailRate.retryAfterSeconds, ipRate.retryAfterSeconds)) },
      );
    }

    const magicLink = await createMagicLink(repositories, email, now);
    const origin = configuredOrigin(env);
    const link = `${origin}/api/auth/verify?token=${encodeURIComponent(magicLink.token)}`;
    const sender = emailSender(env);
    if (isDevelopment(env)) {
      const secret = sessionSecret(env);
      const encrypted = await encryptDevelopmentToken(magicLink.token, secret);
      await env.DB.prepare(
        `UPDATE magic_links SET dev_token_ciphertext = ?, dev_token_iv = ?
         WHERE id = ?`,
      ).bind(encrypted.ciphertext, encrypted.iv, magicLink.id).run();
    }
    await sender.send({
      to: email,
      subject: "Sign in to Digipology",
      text: `Use this single-use link within 15 minutes: ${link}`,
    });
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname === "/api/auth/verify") {
    const token = url.searchParams.get("token");
    if (token === null || token.length > 128) {
      return jsonError(400, "invalid_or_expired_link", "The magic link is invalid or expired");
    }
    const email = await consumeMagicLink(repositories, token, now);
    if (email === null) {
      return jsonError(400, "invalid_or_expired_link", "The magic link is invalid or expired");
    }
    const user = await repositories.findOrCreateUser(email, now);
    const session = await createSession(repositories, user, sessionSecret(env), now);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": serializeSessionCookie(session.token, session.expiresAt),
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
    if (token !== null) await revokeSessionToken(repositories, token, sessionSecret(env), now);
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    const session = await requestSession(request, repositories, env, now);
    return sessionResponse<MeResponse>({ user: session?.user ?? null }, session);
  }

  if (request.method === "PATCH" && url.pathname === "/api/me") {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to update your profile");
    const body = await readJson(request);
    const parsed = validateUpdateMeRequest(body);
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    const name = normalizeDisplayName(parsed.value.name, "Player");
    const user = await repositories.updateUserName(session.user.id, name, now);
    if (user === null) return jsonError(401, "authentication_required", "The session user no longer exists");
    return sessionResponse<UserResponse>({ user }, session);
  }

  if (request.method === "GET" && url.pathname === "/api/games") {
    const response: GamesResponse = {
      games: builtinCatalog.listGames().map(gameSummary),
    };
    return jsonResponse(response);
  }

  const gameMatch = /^\/api\/games\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && gameMatch?.[1] !== undefined) {
    const slug = decodePathSegment(gameMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Game not found");
    const game = builtinCatalog.getGame(slug);
    if (game === null) return jsonError(404, "not_found", "Game not found");
    const release = builtinCatalog.getRelease(game.latestReleaseId);
    if (release === null) return jsonError(404, "not_found", "Game release not found");
    const response: GameResponse = { game: gameSummary(game), latestRelease: releaseSummary(release) };
    return jsonResponse(response);
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(request);
    const parsed = validateCreateRoomRequest(body);
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    const session = await requestSession(request, repositories, env, now);
    if (parsed.value.visibility === "public" && session === null) {
      return jsonError(401, "authentication_required", "Sign in to create a public room");
    }
    const release = builtinCatalog.resolveRelease(parsed.value.releaseSlugOrId);
    if (release === null) return jsonError(404, "release_not_found", "Release not found");
    const game = builtinCatalog.getGame(release.gameSlug);
    if (game === null) return jsonError(404, "release_not_found", "Release game not found");
    const displayName = normalizeDisplayName(parsed.value.displayName, session?.user.name ?? "Host");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const joinCode = generateJoinCode();
      const normalizedCode = normalizeJoinCode(joinCode);
      const id = env.ROOM.newUniqueId();
      const roomId = id.toString();
      try {
        await env.DB.prepare(
          `INSERT INTO rooms_index
            (room_id, join_code, join_code_normalized, visibility, release_id,
             player_count, max_players, created_at, ended_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
        ).bind(
          roomId,
          joinCode,
          normalizedCode,
          parsed.value.visibility,
          release.releaseId,
          game.maxPlayers,
          now,
        ).run();
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }

      const room = env.ROOM.get(id);
      const initialized = await room.init(roomId, joinCode, release.releaseId, game.maxPlayers);
      if (!initialized) {
        await deleteRoomIndex(env.DB, roomId);
        continue;
      }
      const joined = await room.join(displayName);
      if (joined.status !== "ok") {
        await deleteRoomIndex(env.DB, roomId);
        continue;
      }
      await updatePlayerCount(env.DB, roomId, joined.playerCount);
      const response: CreateRoomResponse = {
        roomId,
        joinCode,
        inviteUrl: `${configuredOrigin(env)}/join/${joinCode}`,
        playerId: joined.playerId,
        roomToken: joined.roomToken,
        wsUrl: websocketUrl(url, roomId),
      };
      return jsonResponse(response, 201, sessionCookieHeaders(session));
    }
    return jsonError(503, "room_allocation_failed", "Could not allocate a room code");
  }

  if (request.method === "POST" && url.pathname === "/api/rooms/join") {
    const ipHash = await sha256Hex(clientIp(request));
    const limiter = new FixedWindowRateLimiter(repositories, JOIN_IP_LIMIT, JOIN_RATE_WINDOW_MS);
    const rate = await limiter.consume(`room-join:ip:${ipHash}`, now);
    if (!rate.allowed) {
      return jsonError(429, "rate_limited", "Too many join attempts; try again later", {
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const body = await readJson(request);
    const parsed = validateJoinRoomRequest(body);
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    if (!isValidJoinCode(parsed.value.code)) return joinError("not_found");
    const normalizedCode = normalizeJoinCode(parsed.value.code);
    const row = await env.DB.prepare(
      "SELECT room_id FROM rooms_index WHERE join_code_normalized = ?",
    ).bind(normalizedCode).first<RoomIndexLookupRow>();
    if (row === null) return joinError("not_found");

    let id: DurableObjectId;
    try {
      id = env.ROOM.idFromString(row.room_id);
    } catch {
      return joinError("not_found");
    }
    const result = await env.ROOM.get(id).join(normalizeDisplayName(parsed.value.displayName, "Player"));
    if (result.status === "not_found") return joinError("not_found");
    if (result.status === "ended") {
      await markRoomEnded(env.DB, row.room_id, now);
      return joinError("ended");
    }
    if (result.status === "full") return joinError("full");
    await updatePlayerCount(env.DB, row.room_id, result.playerCount);
    const response: JoinRoomResponse = {
      roomId: row.room_id,
      playerId: result.playerId,
      roomToken: result.roomToken,
      wsUrl: websocketUrl(url, row.room_id),
      releaseId: result.releaseId,
    };
    return jsonResponse(response);
  }

  if (request.method === "GET" && url.pathname === "/api/rooms/public") {
    const result = await env.DB.prepare(
      `SELECT join_code, release_id, player_count, max_players, created_at
       FROM rooms_index
       WHERE visibility = 'public' AND ended_at IS NULL
       ORDER BY created_at DESC LIMIT 100`,
    ).all<PublicRoomRow>();
    const response: PublicRoomsResponse = {
      rooms: result.results.flatMap((row) => {
        const release = builtinCatalog.getRelease(row.release_id);
        const game = release === null ? null : builtinCatalog.getGame(release.gameSlug);
        return game === null ? [] : [{
          joinCode: row.join_code,
          gameTitle: game.title,
          players: row.player_count,
          maxPlayers: row.max_players,
          createdAt: new Date(row.created_at).toISOString(),
        }];
      }),
    };
    return jsonResponse(response);
  }

  const releaseMatch = /^\/api\/releases\/([^/]+)\/bundle$/.exec(url.pathname);
  if (request.method === "GET" && releaseMatch?.[1] !== undefined) {
    const releaseId = decodePathSegment(releaseMatch[1]);
    const release = releaseId === null ? null : builtinCatalog.getRelease(releaseId);
    if (release === null) return jsonError(404, "not_found", "Release not found");
    return jsonResponse(release.bundle, 200, {
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  }

  const websocketMatch = /^\/api\/rooms\/([0-9a-f]{64})\/ws$/.exec(url.pathname);
  if (request.method === "GET" && websocketMatch?.[1] !== undefined) {
    try {
      return env.ROOM.get(env.ROOM.idFromString(websocketMatch[1])).fetch(request);
    } catch {
      return jsonError(404, "not_found", "Room not found");
    }
  }

  if (request.method === "GET" && url.pathname === "/api/dev/last-magic-link") {
    if (!isDevelopment(env)) return jsonError(404, "not_found", "Not found");
    const row = await env.DB.prepare(
      `SELECT dev_token_ciphertext, dev_token_iv FROM magic_links
       WHERE dev_token_ciphertext IS NOT NULL AND dev_token_iv IS NOT NULL
         AND consumed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(now).first<DevelopmentMagicLinkRow>();
    if (row === null) return jsonError(404, "not_found", "No development magic link exists");
    const token = await decryptDevelopmentToken(
      row.dev_token_ciphertext,
      row.dev_token_iv,
      sessionSecret(env),
    );
    return jsonResponse({ link: `${configuredOrigin(env)}/api/auth/verify?token=${encodeURIComponent(token)}` }, 200, {
      "Cache-Control": "no-store",
    });
  }

  return jsonError(404, "not_found", "Not found");
}

export function isCsrfSafe(request: Request): boolean {
  if (request.headers.get(CUSTOM_HEADER) !== "1") return false;
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(request.url).origin;
}

async function requestSession(
  request: Request,
  repositories: D1Repositories,
  env: Env,
  now: number,
): Promise<AuthenticatedSession | null> {
  const token = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
  if (token === null) return null;
  return authenticateSession(repositories, token, sessionSecret(env), now);
}

function sessionResponse<T>(value: T, session: AuthenticatedSession | null): Response {
  return jsonResponse(value, 200, {
    "Cache-Control": "no-store",
    ...sessionCookieHeaders(session),
  });
}

function sessionCookieHeaders(session: AuthenticatedSession | null): HeadersInit {
  return session === null
    ? {}
    : { "Set-Cookie": serializeSessionCookie(session.token, session.expiresAt) };
}

function emailSender(env: Env): EmailSender {
  return isDevelopment(env)
    ? new DevelopmentEmailSender()
    : new CloudflareEmailSender(env.EMAIL, configuredString(env, "EMAIL_FROM", "noreply@digipology.com"));
}

function isDevelopment(env: Env): boolean {
  return configuredString(env, "EMAIL_DEV_MODE", "") === "true";
}

function sessionSecret(env: Env): string {
  const secret = configuredString(env, "SESSION_SECRET", "");
  if (secret.length < 32) throw new Error("SESSION_SECRET is not configured or is too short");
  return secret;
}

function configuredOrigin(env: Env): string {
  return configuredString(env, "PUBLIC_ORIGIN", "https://play.digipology.com").replace(/\/$/, "");
}

function configuredString(env: Env, key: string, fallback: string): string {
  const value = Reflect.get(env, key);
  return typeof value === "string" ? value : fallback;
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > HTTP_BODY_LIMIT) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > HTTP_BODY_LIMIT) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function normalizeDisplayName(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback).trim().replaceAll(/\s+/g, " ");
  return Array.from(normalized || fallback).slice(0, 64).join("");
}

function websocketUrl(requestUrl: URL, roomId: string): string {
  const ws = new URL(`/api/rooms/${roomId}/ws`, requestUrl);
  ws.protocol = requestUrl.protocol === "https:" ? "wss:" : "ws:";
  return ws.toString();
}

async function updatePlayerCount(db: D1Database, roomId: string, playerCount: number): Promise<void> {
  try {
    await db.prepare("UPDATE rooms_index SET player_count = ? WHERE room_id = ?").bind(playerCount, roomId).run();
  } catch (error) {
    logIndexCacheFailure("player_count", roomId, error);
  }
}

async function markRoomEnded(db: D1Database, roomId: string, now: number): Promise<void> {
  try {
    await db.prepare("UPDATE rooms_index SET ended_at = ? WHERE room_id = ?").bind(now, roomId).run();
  } catch (error) {
    logIndexCacheFailure("ended_at", roomId, error);
  }
}

async function deleteRoomIndex(db: D1Database, roomId: string): Promise<void> {
  await db.prepare("DELETE FROM rooms_index WHERE room_id = ?").bind(roomId).run();
}

function joinError(code: "not_found" | "full" | "ended"): Response {
  const details = {
    not_found: [404, "Room not found"],
    full: [409, "Room is full"],
    ended: [410, "Room has ended"],
  } as const;
  const [status, message] = details[code];
  return jsonError(status, code, message);
}

function invalidRequest(message: string): Response {
  return jsonError(400, "invalid_request", message);
}

function jsonError(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function logIndexCacheFailure(field: string, roomId: string, error: unknown): void {
  console.error(JSON.stringify({
    level: "error",
    message: "room discovery cache update failed",
    field,
    roomId,
    error: error instanceof Error ? error.message : String(error),
  }));
}
