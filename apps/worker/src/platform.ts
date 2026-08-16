import type {
  CheckpointAttestationRequest,
  CreateGameResponse,
  CoverUploadResponse,
  CreateReleaseResponse,
  CreateRoomResponse,
  GameResponse,
  GameSnapshotDto,
  GamesResponse,
  JoinRoomResponse,
  MeResponse,
  MyGamesResponse,
  PublicRoomsResponse,
  QuickPlayResponse,
  ResumeSaveResponse,
  SaveTableResponse,
  SavesResponse,
  UpdateGameResponse,
  UploadValidationReportItem,
  UserResponse,
} from "digipology-protocol/http";
import {
  CSRF_HEADER,
  UPLOAD_BODY_LIMIT,
  isGameSlug,
  slugifyGameTitle,
  uploadReportOk,
  validateCreateGameRequest,
  validateCreateReleaseRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  validateQuickPlayRequest,
  validateResumeSaveRequest,
  validateSaveTableRequest,
  validateRequestMagicLinkRequest,
  validateUpdateGameRequest,
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
import { D1Repositories, type GameMetrics, type UploadedGameRecord } from "./d1-repositories";
import { CloudflareEmailSender, DevelopmentEmailSender, type EmailSender } from "./email";
import { FixedWindowRateLimiter } from "./rate-limiter";
import { prepareUploadedBundle, validateUploadedBundle } from "./release-validation";
import { generateGuestName, generateJoinCode, isValidJoinCode, normalizeJoinCode } from "./random";
import { getBuiltinCover } from "./builtin-covers";
import { COVER_BODY_LIMIT, validateCoverImage } from "./cover-image";
import {
  ROOM_HEARTBEAT_STALE_MS,
  runQuickPlayMatchmaking,
  type QuickPlayCandidate,
} from "./quickplay";
import {
  handleAiGameRequest,
  type AiGameDependencies,
} from "./ai-games";
import { handleCoverGeneration } from "./cover-generation";
import { loadSnapshot, snapshotRequiresScripts, type GameSnapshot } from "digipology-kernel";

const HTTP_BODY_LIMIT = 4 * 1024;
const MAGIC_EMAIL_LIMIT = 3;
const MAGIC_IP_LIMIT = 10;
const MAGIC_RATE_WINDOW_MS = 15 * 60 * 1000;
const JOIN_IP_LIMIT = 30;
const JOIN_RATE_WINDOW_MS = 60 * 1000;
const UPLOAD_USER_LIMIT = 10;
const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
const COVER_USER_LIMIT = 20;
const COVER_RATE_WINDOW_MS = 60 * 60 * 1000;
const SAVE_USER_LIMIT = 10;
const SAVE_RATE_WINDOW_MS = 60 * 1000;
const SAVE_COUNT_LIMIT = 50;

interface RoomIndexLookupRow {
  room_id: string;
}

interface RoomSaveLookupRow { release_id: string; game_slug: string; }

interface PublicRoomRow {
  join_code: string;
  release_id: string;
  player_count: number;
  max_players: number;
  created_at: number;
}

interface QuickPlayCandidateRow {
  room_id: string;
  join_code: string;
  player_count: number;
  max_players: number;
  last_heartbeat_at: number | null;
  joinable: number;
}

interface DevelopmentMagicLinkRow {
  dev_token_ciphertext: string;
  dev_token_iv: string;
}

export interface PlatformDependencies extends AiGameDependencies {
  now?: number;
}

export async function handlePlatformRequest(
  request: Request,
  env: Env,
  dependencies: PlatformDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && url.pathname.startsWith("/api/") && !isCsrfSafe(request)) {
    return jsonError(403, "csrf_rejected", `Same-origin requests must include ${CSRF_HEADER}: 1`);
  }

  const repositories = new D1Repositories(env.DB);
  const now = dependencies.now ?? Date.now();

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
    const [uploaded, metrics] = hasDatabase(env)
      ? await Promise.all([
          repositories.listPublicUploadedGames(),
          repositories.listGameMetrics(now - ROOM_HEARTBEAT_STALE_MS),
        ])
      : [[], new Map<string, GameMetrics>()] as const;
    const response: GamesResponse = {
      games: [
        ...builtinCatalog.listGames().map((game) => withMetrics(gameSummary(game), metrics.get(game.slug))),
        ...uploaded.map((game) => uploadedGameSummary(game, metrics.get(game.slug))),
      ],
    };
    return jsonResponse(response);
  }

  if (request.method === "GET" && url.pathname === "/api/games/mine") {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to view your games");
    const response: MyGamesResponse = { games: await repositories.listOwnedGames(session.user.id) };
    return sessionResponse(response, session);
  }

  const aiEditMatch = /^\/api\/ai\/games\/([^/]+)\/edit$/.exec(url.pathname);
  if (
    request.method === "POST" &&
    (url.pathname === "/api/ai/games" || aiEditMatch?.[1] !== undefined)
  ) {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) {
      return jsonError(401, "authentication_required", "Sign in to create or edit a game with AI");
    }
    const slug = aiEditMatch?.[1] === undefined ? undefined : decodePathSegment(aiEditMatch[1]);
    if (aiEditMatch?.[1] !== undefined && slug === null) {
      return jsonError(404, "not_found", "Game not found");
    }
    const aiDependencies = Object.prototype.hasOwnProperty.call(dependencies, "deepseekFetch")
      ? { deepseekFetch: dependencies.deepseekFetch ?? null }
      : undefined;
    return handleAiGameRequest({
      request,
      env,
      repositories,
      session,
      now,
      mode: aiEditMatch?.[1] === undefined ? "create" : "edit",
      ...(slug === undefined || slug === null ? {} : { slug }),
      ...(aiDependencies === undefined ? {} : { dependencies: aiDependencies }),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/games") {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to publish a game");
    const rateResponse = await consumeUploadRate(repositories, session.user.id, now);
    if (rateResponse !== null) return rateResponse;
    const upload = await readUploadJson(request);
    const parsed = validateCreateGameRequest(upload.value);
    const record = asRecord(upload.value);
    const title = parsed.ok ? parsed.value.title : typeof record?.title === "string" ? record.title : "";
    const slugCandidate = parsed.ok
      ? parsed.value.slug ?? slugifyGameTitle(parsed.value.title)
      : typeof record?.slug === "string" ? record.slug : slugifyGameTitle(title);
    const slugUnique = isGameSlug(slugCandidate) && builtinCatalog.getGame(slugCandidate) === null &&
      !(await repositories.uploadedSlugExists(slugCandidate));
    const minPlayers = parsed.ok ? parsed.value.minPlayers : numberField(record, "minPlayers");
    const maxPlayers = parsed.ok ? parsed.value.maxPlayers : numberField(record, "maxPlayers");
    const bundleValue = parsed.ok ? parsed.value.bundle : record?.bundle;
    const bundleReport = validateUploadedBundle(bundleValue, minPlayers, maxPlayers);
    markJsonParseFailure(bundleReport, upload.parseError);
    const report: UploadValidationReportItem[] = [
      reportItem("size", !upload.oversize, upload.oversize ? `request body exceeds ${UPLOAD_BODY_LIMIT} bytes` : undefined),
      reportItem("dto_shape", parsed.ok, parsed.ok ? undefined : parsed.error.message),
      reportItem("slug", slugUnique, slugUnique ? undefined : "slug is invalid or already in use"),
      ...bundleReport,
    ];
    if (!uploadReportOk(report)) return validationFailed(report);
    if (!parsed.ok) throw new Error("Validated create-game DTO was not available");
    const bucket = releaseBucket(env);
    if (bucket === null) return jsonError(503, "release_storage_unavailable", "Release storage is unavailable");
    const gameId = `game_${crypto.randomUUID()}`;
    const releaseId = `release_${crypto.randomUUID()}`;
    const prepared = prepareUploadedBundle(parsed.value.bundle, {
      gameId, releaseId, releaseNumber: 1, title: parsed.value.title,
    });
    const bundleKey = releaseObjectKey(releaseId);
    await writeReleaseThenCommit(bucket, bundleKey, prepared.canonicalJson, () =>
      repositories.createUploadedGame({
        gameId,
        releaseId,
        ownerUserId: session.user.id,
        slug: slugCandidate,
        title: parsed.value.title,
        tagline: parsed.value.tagline,
        minPlayers: parsed.value.minPlayers,
        maxPlayers: parsed.value.maxPlayers,
        manifestHash: prepared.bundle.integrity.manifestHash,
        bundleKey,
        now,
      }));
    const game = (await repositories.listOwnedGames(session.user.id))
      .find((candidate) => candidate.slug === slugCandidate);
    if (game === undefined) throw new Error("Created game could not be reloaded");
    const response: CreateGameResponse = { game, release: game.releases[0]! };
    return jsonResponse(response, 201, sessionCookieHeaders(session));
  }

  const releaseCreateMatch = /^\/api\/games\/([^/]+)\/releases$/.exec(url.pathname);
  if (request.method === "POST" && releaseCreateMatch?.[1] !== undefined) {
    const slug = decodePathSegment(releaseCreateMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Game not found");
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to publish a release");
    const game = await repositories.getUploadedGame(slug);
    if (game === null) return jsonError(404, "not_found", "Game not found");
    if (game.ownerUserId !== session.user.id) return jsonError(403, "forbidden", "Only the game owner can publish releases");
    const rateResponse = await consumeUploadRate(repositories, session.user.id, now);
    if (rateResponse !== null) return rateResponse;
    const upload = await readUploadJson(request);
    const parsed = validateCreateReleaseRequest(upload.value);
    const record = asRecord(upload.value);
    const bundleReport = validateUploadedBundle(
      parsed.ok ? parsed.value.bundle : record?.bundle,
      game.minPlayers,
      game.maxPlayers,
    );
    markJsonParseFailure(bundleReport, upload.parseError);
    const report: UploadValidationReportItem[] = [
      reportItem("size", !upload.oversize, upload.oversize ? `request body exceeds ${UPLOAD_BODY_LIMIT} bytes` : undefined),
      reportItem("dto_shape", parsed.ok, parsed.ok ? undefined : parsed.error.message),
      reportItem("slug", true),
      ...bundleReport,
    ];
    if (!uploadReportOk(report)) return validationFailed(report);
    if (!parsed.ok) throw new Error("Validated create-release DTO was not available");
    const bucket = releaseBucket(env);
    if (bucket === null) return jsonError(503, "release_storage_unavailable", "Release storage is unavailable");
    const releases = (await repositories.listOwnedGames(session.user.id))
      .find((candidate) => candidate.slug === slug)?.releases ?? [];
    const releaseNumber = Math.max(0, ...releases.map((candidate) => candidate.releaseNumber)) + 1;
    const releaseId = `release_${crypto.randomUUID()}`;
    const prepared = prepareUploadedBundle(parsed.value.bundle, {
      gameId: game.id, releaseId, releaseNumber, title: game.title,
    });
    const bundleKey = releaseObjectKey(releaseId);
    await writeReleaseThenCommit(bucket, bundleKey, prepared.canonicalJson, () =>
      repositories.createUploadedRelease({
        gameId: game.id,
        releaseId,
        releaseNumber,
        manifestHash: prepared.bundle.integrity.manifestHash,
        bundleKey,
        now,
      }));
    const release = (await repositories.getUploadedRelease(releaseId));
    if (release === null) throw new Error("Created release could not be reloaded");
    const response: CreateReleaseResponse = { release };
    return jsonResponse(response, 201, sessionCookieHeaders(session));
  }

  const coverMatch = /^\/api\/games\/([^/]+)\/cover$/.exec(url.pathname);
  const coverGenerateMatch = /^\/api\/games\/([^/]+)\/covers\/generate$/.exec(url.pathname);
  if (request.method === "POST" && coverGenerateMatch?.[1] !== undefined) {
    const slug = decodePathSegment(coverGenerateMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Game not found");
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to generate a cover");
    const coverDependencies = Object.prototype.hasOwnProperty.call(dependencies, "deepseekFetch")
      ? { deepseekFetch: dependencies.deepseekFetch ?? null }
      : undefined;
    return handleCoverGeneration({
      env,
      repositories,
      session,
      slug,
      now,
      ...(coverDependencies === undefined ? {} : { dependencies: coverDependencies }),
    });
  }

  if (coverMatch?.[1] !== undefined && request.method === "POST") {
    const slug = decodePathSegment(coverMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Game not found");
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to upload a cover");
    if (builtinCatalog.getGame(slug) !== null) {
      return jsonError(403, "forbidden", "Built-in game covers cannot be changed");
    }
    const game = await repositories.getUploadedGame(slug);
    if (game === null) return jsonError(404, "not_found", "Game not found");
    if (game.ownerUserId !== session.user.id) {
      return jsonError(403, "forbidden", "Only the game owner can upload a cover");
    }
    const limiter = new FixedWindowRateLimiter(repositories, COVER_USER_LIMIT, COVER_RATE_WINDOW_MS);
    const rate = await limiter.consume(`cover:user:${session.user.id}`, now);
    if (!rate.allowed) {
      return jsonError(429, "rate_limited", "Too many cover uploads; try again later", {
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const body = await readCoverBody(request);
    if (body.oversize) {
      return jsonError(413, "body_too_large", `Cover body exceeds ${COVER_BODY_LIMIT} bytes`);
    }
    const validation = validateCoverImage(body.bytes, request.headers.get("Content-Type"));
    if (!validation.ok) return jsonError(422, validation.code, validation.message);
    const bucket = releaseBucket(env);
    if (bucket === null) return jsonError(503, "cover_storage_unavailable", "Cover storage is unavailable");
    await bucket.put(coverObjectKey(game.id), body.bytes, {
      httpMetadata: { contentType: validation.contentType },
    });
    const updated = await env.DB.prepare(
      `UPDATE games SET cover_version = COALESCE(cover_version, 0) + 1, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND builtin = 0
       RETURNING cover_version`,
    ).bind(now, game.id, session.user.id).first<{ cover_version: number }>();
    if (updated === null) return jsonError(403, "forbidden", "Only the game owner can upload a cover");
    const response: CoverUploadResponse = { coverVersion: updated.cover_version };
    return jsonResponse(response, 200, sessionCookieHeaders(session));
  }

  if (coverMatch?.[1] !== undefined && request.method === "GET") {
    const slug = decodePathSegment(coverMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Cover not found");
    const builtinCover = getBuiltinCover(slug);
    if (builtinCover !== null) {
      return new Response(builtinCover.body, {
        headers: coverResponseHeaders(url, builtinCover.contentType, builtinCover.version),
      });
    }
    if (!hasDatabase(env)) return jsonError(404, "not_found", "Cover not found");
    const game = await repositories.getUploadedGame(slug);
    if (game === null || game.coverVersion === null) return jsonError(404, "not_found", "Cover not found");
    const bucket = releaseBucket(env);
    if (bucket === null) return jsonError(503, "cover_storage_unavailable", "Cover storage is unavailable");
    const object = await bucket.get(coverObjectKey(game.id));
    if (object === null) return jsonError(404, "not_found", "Cover not found");
    const headers = coverResponseHeaders(
      url,
      object.httpMetadata?.contentType ?? "application/octet-stream",
      game.coverVersion,
    );
    headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
  }

  const gameMatch = /^\/api\/games\/([^/]+)$/.exec(url.pathname);
  if (gameMatch?.[1] !== undefined && request.method === "PATCH") {
    const slug = decodePathSegment(gameMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Game not found");
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to update a game");
    const game = await repositories.getUploadedGame(slug);
    if (game === null) return jsonError(404, "not_found", "Game not found");
    if (game.ownerUserId !== session.user.id) return jsonError(403, "forbidden", "Only the game owner can update this game");
    const parsed = validateUpdateGameRequest(await readJson(request));
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    await repositories.updateGameVisibility(slug, session.user.id, parsed.value.visibility, now);
    const updated = (await repositories.listOwnedGames(session.user.id)).find((candidate) => candidate.slug === slug);
    if (updated === undefined) throw new Error("Updated game could not be reloaded");
    const response: UpdateGameResponse = { game: updated };
    return sessionResponse(response, session);
  }

  if (request.method === "GET" && gameMatch?.[1] !== undefined) {
    const slug = decodePathSegment(gameMatch[1]);
    if (slug === null) return jsonError(404, "not_found", "Game not found");
    const game = builtinCatalog.getGame(slug);
    if (game !== null) {
      const release = builtinCatalog.getRelease(game.latestReleaseId);
      if (release === null) return jsonError(404, "not_found", "Game release not found");
      const metrics = hasDatabase(env)
        ? (await repositories.listGameMetrics(now - ROOM_HEARTBEAT_STALE_MS)).get(slug)
        : undefined;
      const response: GameResponse = {
        game: withMetrics(gameSummary(game), metrics),
        latestRelease: releaseSummary(release),
      };
      return jsonResponse(response);
    }
    const uploaded = hasDatabase(env) ? await repositories.getUploadedGame(slug) : null;
    if (uploaded === null) return jsonError(404, "not_found", "Game not found");
    const release = await repositories.getUploadedRelease(uploaded.latestReleaseId);
    if (release === null) return jsonError(404, "not_found", "Game release not found");
    const response: GameResponse = {
      game: uploadedGameSummary(
        uploaded,
        (await repositories.listGameMetrics(now - ROOM_HEARTBEAT_STALE_MS)).get(slug),
      ),
      latestRelease: {
        releaseId: release.releaseId,
        kernelVersion: release.kernelVersion,
        luaApiVersion: release.luaApiVersion,
        releaseNumber: release.releaseNumber,
        createdAt: release.createdAt,
      },
    };
    return jsonResponse(response);
  }

  if (request.method === "POST" && url.pathname === "/api/quickplay") {
    const ipHash = await sha256Hex(clientIp(request));
    const limiter = new FixedWindowRateLimiter(repositories, JOIN_IP_LIMIT, JOIN_RATE_WINDOW_MS);
    const rate = await limiter.consume(`quickplay:ip:${ipHash}`, now);
    if (!rate.allowed) {
      return jsonError(429, "rate_limited", "Too many quick-play attempts; try again later", {
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const parsed = validateQuickPlayRequest(await readJson(request));
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    const session = await requestSession(request, repositories, env, now);
    const builtinGame = builtinCatalog.getGame(parsed.value.slug);
    const builtinRelease = builtinGame === null ? null : builtinCatalog.getRelease(builtinGame.latestReleaseId);
    const uploadedGame = builtinGame === null ? await repositories.getUploadedGame(parsed.value.slug) : null;
    if (builtinRelease === null && (uploadedGame === null || uploadedGame.visibility !== "public")) {
      return jsonError(404, "game_not_found", "Game not found");
    }
    const releaseId = builtinRelease?.releaseId ?? uploadedGame?.latestReleaseId;
    const maxPlayers = builtinGame?.maxPlayers ?? uploadedGame?.maxPlayers;
    if (releaseId === undefined || maxPlayers === undefined) {
      return jsonError(404, "game_not_found", "Game not found");
    }
    const displayName = session !== null
      ? normalizeDisplayName(session.user.name, session.user.name)
      : normalizeDisplayName(parsed.value.displayName, generateGuestName());
    const result = await runQuickPlayMatchmaking(now, {
      select: async () => {
        const rows = await env.DB.prepare(
          `SELECT room_id, join_code, player_count, max_players, last_heartbeat_at, joinable
           FROM rooms_index
           WHERE release_id = ? AND visibility = 'public' AND ended_at IS NULL
             AND joinable = 1
             AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at >= ?
             AND player_count < max_players
           ORDER BY player_count DESC, created_at ASC LIMIT 12`,
        ).bind(releaseId, now - ROOM_HEARTBEAT_STALE_MS).all<QuickPlayCandidateRow>();
        return rows.results.map(quickPlayCandidate);
      },
      claim: async (candidate) => {
        const claimed = await env.DB.prepare(
          `UPDATE rooms_index SET player_count = player_count + 1
           WHERE room_id = ? AND ended_at IS NULL AND joinable = 1
             AND player_count < max_players
             AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at >= ?`,
        ).bind(candidate.roomId, now - ROOM_HEARTBEAT_STALE_MS).run();
        return claimed.meta.changes > 0;
      },
      join: async (candidate) => {
        try {
          const id = env.ROOM.idFromString(candidate.roomId);
          const joined = await env.ROOM.get(id).join(displayName, true, session?.user.id ?? null);
          return joined.status === "ok"
            ? { status: "ok" as const, value: joined }
            : { status: joined.status };
        } catch {
          return { status: "not_found" as const };
        }
      },
      reconcile: async (candidate, outcome) => {
        if (outcome === "full") {
          await updatePlayerCount(env.DB, candidate.roomId, candidate.maxPlayers);
        } else if (outcome === "ineligible") {
          await markRoomIneligible(env.DB, candidate.roomId);
        } else {
          await markRoomEnded(env.DB, candidate.roomId, now);
        }
      },
    });
    if (result.decision === "joined") {
      const response: QuickPlayResponse = {
        roomId: result.candidate.roomId,
        joinCode: result.candidate.joinCode,
        playerId: result.value.playerId,
        roomToken: result.value.roomToken,
        wsUrl: websocketUrl(url, result.candidate.roomId),
        releaseId: result.value.releaseId,
      };
      return jsonResponse(response, 200, sessionCookieHeaders(session));
    }
    const created = await allocateRoomForPlayer(env, {
      releaseId,
      gameSlug: parsed.value.slug,
      maxPlayers,
      visibility: "public",
      origin: "quickplay",
      displayName,
      now,
      creatorUserId: session?.user.id ?? null,
    });
    if (created === null) {
      return jsonError(503, "quickplay_unavailable", "Quick play is temporarily unavailable");
    }
    const response: QuickPlayResponse = {
      roomId: created.roomId,
      joinCode: created.joinCode,
      playerId: created.playerId,
      roomToken: created.roomToken,
      wsUrl: websocketUrl(url, created.roomId),
      releaseId: created.releaseId,
    };
    return jsonResponse(response, 200, sessionCookieHeaders(session));
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(request);
    const parsed = validateCreateRoomRequest(body);
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    const session = await requestSession(request, repositories, env, now);
    if (parsed.value.visibility === "public" && session === null) {
      return jsonError(401, "authentication_required", "Sign in to create a public room");
    }
    const builtinRelease = builtinCatalog.resolveRelease(parsed.value.releaseSlugOrId);
    const builtinGame = builtinRelease === null ? null : builtinCatalog.getGame(builtinRelease.gameSlug);
    const uploadedRelease = builtinRelease === null
      ? await repositories.resolveUploadedRelease(parsed.value.releaseSlugOrId)
      : null;
    const releaseId = builtinRelease?.releaseId ?? uploadedRelease?.releaseId;
    const maxPlayers = builtinGame?.maxPlayers ?? uploadedRelease?.maxPlayers;
    const gameSlug = builtinGame?.slug ?? uploadedRelease?.gameSlug;
    if (releaseId === undefined || maxPlayers === undefined || gameSlug === undefined) {
      return jsonError(404, "release_not_found", "Release not found");
    }
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
             player_count, max_players, created_at, ended_at, origin,
             last_heartbeat_at, game_slug, joinable, creator_user_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, 'hosted', ?, ?, 1, ?)`,
        ).bind(
          roomId,
          joinCode,
          normalizedCode,
          parsed.value.visibility,
          releaseId,
          maxPlayers,
          now,
          now,
          gameSlug,
          session?.user.id ?? null,
        ).run();
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }

      const room = env.ROOM.get(id);
      const initialized = await room.init(roomId, joinCode, releaseId, maxPlayers, session?.user.id ?? null);
      if (!initialized) {
        await deleteRoomIndex(env.DB, roomId);
        continue;
      }
      const joined = await room.join(displayName, false, session?.user.id ?? null);
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
    if (result.status === "ineligible") {
      throw new Error("Manual room join was unexpectedly checked for quick-play eligibility");
    }
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
    const rooms: PublicRoomsResponse["rooms"] = [];
    for (const row of result.results) {
      const release = builtinCatalog.getRelease(row.release_id);
      const builtinGame = release === null ? null : builtinCatalog.getGame(release.gameSlug);
      const uploaded = release === null ? await repositories.getUploadedRelease(row.release_id) : null;
      const title = builtinGame?.title ?? uploaded?.gameTitle;
      if (title === undefined) continue;
      rooms.push({
        joinCode: row.join_code,
        gameTitle: title,
        players: row.player_count,
        maxPlayers: row.max_players,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }
    const response: PublicRoomsResponse = { rooms };
    return jsonResponse(response);
  }

  const roomEndMatch = /^\/api\/rooms\/([0-9a-f]{64})\/end$/.exec(url.pathname);
  if (request.method === "POST" && roomEndMatch?.[1] !== undefined) {
    const body = asRecord(await readJson(request));
    if (body === null || typeof body.roomToken !== "string") {
      return jsonError(403, "end_unauthorized", "Room token was not accepted");
    }
    try {
      const outcome = await env.ROOM.get(env.ROOM.idFromString(roomEndMatch[1])).endWithToken(body.roomToken);
      if (outcome === "unauthorized") return jsonError(403, "end_unauthorized", "Room token was not accepted");
      if (outcome === "host_only") return jsonError(403, "end_host_only", "Only the table host can end the table");
      if (outcome === "unavailable") return jsonError(409, "end_unavailable", "The table has already ended");
      return new Response(null, { status: 204 });
    } catch { return jsonError(404, "not_found", "Room not found"); }
  }

  const roomSaveMatch = /^\/api\/rooms\/([0-9a-f]{64})\/save$/.exec(url.pathname);
  if (request.method === "POST" && roomSaveMatch?.[1] !== undefined) {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to save this table");
    const limiter = new FixedWindowRateLimiter(repositories, SAVE_USER_LIMIT, SAVE_RATE_WINDOW_MS);
    const rate = await limiter.consume(`save:user:${session.user.id}`, now);
    if (!rate.allowed) return jsonError(429, "rate_limited", "Too many saves; try again later", { "Retry-After": String(rate.retryAfterSeconds) });
    const upload = await readUploadJson(request);
    if (upload.oversize) return jsonError(413, "save_too_large", "Save exceeds the 1 MiB limit");
    const requestBody = asRecord(upload.value);
    if (requestBody === null || typeof requestBody.roomToken !== "string") {
      return jsonError(403, "save_unauthorized", "Room token was not accepted");
    }
    const parsed = validateSaveTableRequest(upload.value);
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    if (await repositories.countActiveSaves(session.user.id) >= SAVE_COUNT_LIMIT) {
      return jsonError(409, "save_limit_reached", `You can keep up to ${SAVE_COUNT_LIMIT} saved tables`);
    }
    const metadata = await env.DB.prepare(
      "SELECT release_id, game_slug FROM rooms_index WHERE room_id = ?",
    ).bind(roomSaveMatch[1]).first<RoomSaveLookupRow>();
    if (metadata === null) return jsonError(404, "not_found", "Room not found");
    let outcome;
    try {
      outcome = await env.ROOM.get(env.ROOM.idFromString(roomSaveMatch[1])).saveSnapshot(
        parsed.value.roomToken,
        parsed.value.snapshot,
      );
    } catch { return jsonError(404, "not_found", "Room not found"); }
    if (outcome.status !== "ok") {
      if (outcome.status === "unauthorized") return jsonError(403, "save_unauthorized", "Room token was not accepted");
      if (outcome.status === "host_only") return jsonError(403, "save_host_only", "Only the table host can save");
      if (outcome.status === "unavailable") return jsonError(409, "save_unavailable", "This table cannot be saved right now");
      if (outcome.status === "stale") return jsonError(409, "save_stale", "The table moved on; try again");
      return jsonError(422, "save_invalid", outcome.reason ?? "Snapshot integrity check failed");
    }
    const savedSnapshot = JSON.parse(outcome.snapshotJson) as GameSnapshotDto;
    if (savedSnapshot.releaseId !== metadata.release_id) return jsonError(422, "save_invalid", "Snapshot release does not match the room index");
    const requiresScripts = snapshotRequiresScripts(savedSnapshot as unknown as GameSnapshot);
    const bucket = saveBucket(env);
    if (bucket === null) return jsonError(503, "save_storage_unavailable", "Save storage is unavailable");
    const saveId = `save_${crypto.randomUUID()}`;
    const objectKey = `saves/${saveId}.json`;
    const body = JSON.stringify(savedSnapshot);
    const byteLength = new TextEncoder().encode(body).byteLength;
    if (byteLength > UPLOAD_BODY_LIMIT) return jsonError(413, "save_too_large", "Save exceeds the 1 MiB limit");
    await writeReleaseThenCommit(bucket, objectKey, body, () => repositories.createSavedTable({
      id: saveId, ownerUserId: session.user.id, releaseId: savedSnapshot.releaseId,
      gameSlug: metadata.game_slug, sourceRoomId: roomSaveMatch[1]!,
      sequence: savedSnapshot.sequence, stateHash: savedSnapshot.stateHash,
      objectKey, byteLength, requiresScripts,
      ...(parsed.value.label === undefined ? {} : { label: parsed.value.label }),
      createdAt: now, deletedAt: null,
    }));
    const response: SaveTableResponse = {
      saveId, sequence: savedSnapshot.sequence, stateHash: savedSnapshot.stateHash,
      createdAt: new Date(now).toISOString(),
    };
    return jsonResponse(response, 201, sessionCookieHeaders(session));
  }

  if (request.method === "GET" && url.pathname === "/api/saves") {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to view saved tables");
    const records = await repositories.listSavedTables(session.user.id);
    const saves: SavesResponse["saves"] = [];
    for (const record of records) {
      const builtinRelease = builtinCatalog.getRelease(record.releaseId);
      const builtinGame = builtinRelease === null ? null : builtinCatalog.getGame(builtinRelease.gameSlug);
      const uploaded = builtinRelease === null ? await repositories.getUploadedRelease(record.releaseId) : null;
      saves.push({
        saveId: record.id, gameSlug: record.gameSlug,
        gameTitle: builtinGame?.title ?? uploaded?.gameTitle ?? record.gameSlug,
        releaseId: record.releaseId, sequence: record.sequence,
        createdAt: new Date(record.createdAt).toISOString(), byteLength: record.byteLength,
        resumable: !record.requiresScripts,
        ...(record.requiresScripts ? { resumeBlockedReason: "scripted_resume_unsupported" } : {}),
        ...(record.label === undefined ? {} : { label: record.label }),
      });
    }
    return sessionResponse({ saves } satisfies SavesResponse, session);
  }

  const saveMatch = /^\/api\/saves\/([^/]+)$/.exec(url.pathname);
  if (saveMatch?.[1] !== undefined && request.method === "DELETE") {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to delete a saved table");
    const record = await repositories.softDeleteSavedTable(saveMatch[1], session.user.id, now);
    if (record === null) return jsonError(404, "not_found", "Saved table not found");
    const bucket = saveBucket(env);
    if (bucket !== null) {
      try { await bucket.delete(record.objectKey); } catch (error) {
        console.error(JSON.stringify({ level: "error", message: "save object delete failed", saveId: record.id, error: String(error) }));
      }
    }
    return new Response(null, { status: 204, headers: sessionCookieHeaders(session) });
  }

  const resumeMatch = /^\/api\/saves\/([^/]+)\/resume$/.exec(url.pathname);
  if (resumeMatch?.[1] !== undefined && request.method === "POST") {
    const session = await requestSession(request, repositories, env, now);
    if (session === null) return jsonError(401, "authentication_required", "Sign in to resume a saved table");
    const parsed = validateResumeSaveRequest(await readJson(request));
    if (!parsed.ok) return invalidRequest(parsed.error.message);
    const record = await repositories.getOwnedSavedTable(resumeMatch[1], session.user.id);
    if (record === null) return jsonError(404, "not_found", "Saved table not found");
    const builtinRelease = builtinCatalog.getRelease(record.releaseId);
    const builtinGame = builtinRelease === null ? null : builtinCatalog.getGame(builtinRelease.gameSlug);
    const uploaded = builtinRelease === null ? await repositories.getUploadedRelease(record.releaseId) : null;
    if (builtinGame === null && (uploaded === null || uploaded.status !== "ready")) {
      return jsonError(410, "release_unavailable", "This game's release is no longer available");
    }
    const bucket = saveBucket(env);
    if (bucket === null) return jsonError(503, "save_storage_unavailable", "Save storage is unavailable");
    const object = await bucket.get(record.objectKey);
    if (object === null) return jsonError(410, "save_unavailable", "The saved snapshot is no longer available");
    let saved: GameSnapshotDto;
    try {
      saved = JSON.parse(await object.text()) as GameSnapshotDto;
      loadSnapshot(saved as unknown as GameSnapshot);
      if (saved.releaseId !== record.releaseId || saved.sequence !== record.sequence || saved.stateHash !== record.stateHash) throw new Error("Save metadata mismatch");
    } catch { return jsonError(422, "save_invalid", "The saved snapshot failed its integrity check"); }
    if (snapshotRequiresScripts(saved as unknown as GameSnapshot)) {
      return jsonError(409, "scripted_resume_unsupported", "Scripted games can't be resumed yet. Your save is kept safe and will resume once support lands.");
    }
    const gameTitle = builtinGame?.title ?? uploaded?.gameTitle ?? record.gameSlug;
    const created = await allocateRoomForPlayer(env, {
      releaseId: record.releaseId, gameSlug: record.gameSlug,
      maxPlayers: builtinGame?.maxPlayers ?? uploaded!.maxPlayers,
      visibility: parsed.value.visibility ?? "private", origin: "hosted",
      displayName: normalizeDisplayName(parsed.value.displayName, session.user.name), now,
      creatorUserId: session.user.id, savedSnapshot: saved, resumedFromSaveId: record.id,
    });
    if (created === null) return jsonError(503, "room_allocation_failed", "Could not resume this table");
    const response: ResumeSaveResponse = {
      roomId: created.roomId, joinCode: created.joinCode,
      inviteUrl: `${configuredOrigin(env)}/join/${created.joinCode}`,
      playerId: created.playerId, roomToken: created.roomToken,
      wsUrl: websocketUrl(url, created.roomId), releaseId: created.releaseId, gameTitle,
    };
    return jsonResponse(response, 201, sessionCookieHeaders(session));
  }

  const releaseMatch = /^\/api\/releases\/([^/]+)\/bundle$/.exec(url.pathname);
  if (request.method === "GET" && releaseMatch?.[1] !== undefined) {
    const releaseId = decodePathSegment(releaseMatch[1]);
    const release = releaseId === null ? null : builtinCatalog.getRelease(releaseId);
    const cacheHeaders = {
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    if (release !== null) return jsonResponse(release.bundle, 200, cacheHeaders);
    if (releaseId === null || !hasDatabase(env)) return jsonError(404, "not_found", "Release not found");
    const uploaded = await repositories.getUploadedRelease(releaseId);
    if (uploaded === null || uploaded.status !== "ready") return jsonError(404, "not_found", "Release not found");
    const bucket = releaseBucket(env);
    if (bucket === null) return jsonError(503, "release_storage_unavailable", "Release storage is unavailable");
    const object = await bucket.get(uploaded.bundleKey);
    if (object === null) return jsonError(404, "not_found", "Release not found");
    return new Response(object.body, {
      headers: { ...cacheHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const roomCheckpointMatch = /^\/api\/rooms\/([0-9a-f]{64})\/checkpoints$/.exec(url.pathname);
  if (request.method === "POST" && roomCheckpointMatch?.[1] !== undefined) {
    const parsed = await readUploadJson(request);
    if (parsed.oversize) {
      return jsonError(413, "checkpoint_too_large", "Checkpoint exceeds the 1 MiB limit");
    }
    const body = asRecord(parsed.value);
    if (body === null || typeof body.roomToken !== "string" ||
      typeof body.sequence !== "number" || !Number.isSafeInteger(body.sequence) ||
      typeof body.stateHash !== "string" ||
      asRecord(body.snapshot) === null) {
      return invalidRequest("Checkpoint attestation is invalid");
    }
    const attestation = body as unknown as CheckpointAttestationRequest;
    try {
      const room = env.ROOM.get(env.ROOM.idFromString(roomCheckpointMatch[1]));
      const outcome = await room.attestCheckpoint(attestation.roomToken, {
        sequence: attestation.sequence,
        stateHash: attestation.stateHash,
        snapshot: attestation.snapshot,
      });
      switch (outcome.status) {
        case "accepted":
        case "confirmed":
        case "duplicate":
          return new Response(null, { status: 204 });
        case "unauthorized":
          return jsonError(403, "checkpoint_unauthorized", "Room token was not accepted");
        case "rate_limited":
          return jsonError(429, "rate_limited", "Too many checkpoint attestations", {
            "Retry-After": "60",
          });
        case "divergent":
          return jsonError(409, "checkpoint_divergent", outcome.reason ?? "Checkpoint hashes diverged");
        case "conflicted":
          return jsonError(
            409,
            "checkpoint_conflicted",
            "This checkpoint sequence was already contested; the room will attest a later one",
          );
        case "rejected":
          return jsonError(422, "checkpoint_rejected", outcome.reason ?? "Checkpoint was not accepted");
      }
    } catch {
      return jsonError(404, "not_found", "Room not found");
    }
  }

  const roomTimerMatch = /^\/api\/rooms\/([0-9a-f]{64})\/timers$/.exec(url.pathname);
  if (request.method === "POST" && roomTimerMatch?.[1] !== undefined) {
    const body = asRecord(await readJson(request));
    if (body === null || typeof body.roomToken !== "string" ||
      typeof body.timerId !== "string" ||
      (body.operation !== "register" && body.operation !== "cancel") ||
      (body.operation === "register" && typeof body.delay !== "number")) {
      return invalidRequest("Timer metadata is invalid");
    }
    try {
      const room = env.ROOM.get(env.ROOM.idFromString(roomTimerMatch[1]));
      const accepted = body.operation === "register"
        ? await room.scheduleCanonicalTimer(body.roomToken, body.timerId, body.delay as number)
        : await room.cancelCanonicalTimerForPlayer(body.roomToken, body.timerId);
      return accepted
        ? new Response(null, { status: 204 })
        : jsonError(403, "timer_rejected", "Timer metadata was not accepted");
    } catch {
      return jsonError(404, "not_found", "Room not found");
    }
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
  if (request.headers.get(CSRF_HEADER) !== "1") return false;
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

export async function readUploadJson(request: Request): Promise<{
  value: unknown;
  oversize: boolean;
  parseError?: string;
}> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > UPLOAD_BODY_LIMIT) {
    return { value: null, oversize: true, parseError: "body was not parsed because it exceeds the size limit" };
  }
  if (request.body === null) return { value: null, oversize: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let oversize = false;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = next.value;
    if (length + chunk.byteLength > UPLOAD_BODY_LIMIT) {
      const remaining = UPLOAD_BODY_LIMIT - length;
      if (remaining > 0) chunks.push(chunk.slice(0, remaining));
      oversize = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown, oversize };
  } catch (error) {
    return { value: null, oversize, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function markJsonParseFailure(report: UploadValidationReportItem[], detail: string | undefined): void {
  if (detail === undefined) return;
  const canonical = report.find((item) => item.check === "canonical_json");
  if (canonical !== undefined) Object.assign(canonical, { ok: false, detail });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberField(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key];
  return typeof value === "number" ? value : 0;
}

function reportItem(
  check: UploadValidationReportItem["check"],
  ok: boolean,
  detail?: string,
): UploadValidationReportItem {
  return detail === undefined ? { check, ok } : { check, ok, detail };
}

function validationFailed(report: UploadValidationReportItem[]): Response {
  return jsonResponse({
    error: { code: "validation_failed", message: "The uploaded release did not pass validation" },
    report,
  }, 422);
}

async function consumeUploadRate(
  repositories: D1Repositories,
  userId: string,
  now: number,
): Promise<Response | null> {
  const limiter = new FixedWindowRateLimiter(repositories, UPLOAD_USER_LIMIT, UPLOAD_RATE_WINDOW_MS);
  const rate = await limiter.consume(`upload:user:${userId}`, now);
  return rate.allowed ? null : jsonError(429, "rate_limited", "Too many uploads; try again later", {
    "Retry-After": String(rate.retryAfterSeconds),
  });
}

function uploadedGameSummary(
  game: UploadedGameRecord,
  metrics?: GameMetrics,
): GamesResponse["games"][number] {
  return withMetrics({
    slug: game.slug,
    title: game.title,
    tagline: game.tagline,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    builtin: false,
    creatorHandle: game.creatorHandle,
    currentPlayers: 0,
    totalPlays: game.totalPlays ?? 0,
    coverVersion: game.coverVersion ?? null,
  }, metrics);
}

function withMetrics(
  game: GamesResponse["games"][number],
  metrics?: GameMetrics,
): GamesResponse["games"][number] {
  // coverVersion deliberately stays from the summary: builtin covers version
  // from code (BUILTIN_COVER_VERSION), not from the seeded D1 games row.
  return metrics === undefined ? game : {
    ...game,
    currentPlayers: metrics.currentPlayers,
    totalPlays: metrics.totalPlays,
  };
}

function hasDatabase(env: Env): boolean {
  return Reflect.get(env, "DB") !== undefined;
}

function releaseBucket(env: Env): R2Bucket | null {
  const candidate = Reflect.get(env, "RELEASES");
  return candidate === undefined ? null : candidate as R2Bucket;
}

/** Saves intentionally share the release bucket under a disjoint immutable prefix. */
export function saveBucket(env: Env): R2Bucket | null { return releaseBucket(env); }

function releaseObjectKey(releaseId: string): string {
  return `releases/${releaseId}.json`;
}

function coverObjectKey(gameId: string): string {
  return `covers/${gameId}`;
}

function coverResponseHeaders(url: URL, contentType: string, version: number): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": url.searchParams.get("v") === String(version)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });
  return headers;
}

async function putReleaseOnce(bucket: R2Bucket, key: string, body: string): Promise<void> {
  const stored = await bucket.put(key, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  if (stored === null) throw new Error(`Release object already exists: ${key}`);
}

export async function writeReleaseThenCommit(
  bucket: R2Bucket,
  key: string,
  body: string,
  commit: () => Promise<void>,
): Promise<void> {
  await putReleaseOnce(bucket, key, body);
  await commit();
}

export async function readCoverBody(request: Request): Promise<{
  bytes: Uint8Array;
  oversize: boolean;
}> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > COVER_BODY_LIMIT) {
    return { bytes: new Uint8Array(), oversize: true };
  }
  if (request.body === null) return { bytes: new Uint8Array(), oversize: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (length + next.value.byteLength > COVER_BODY_LIMIT) {
      await reader.cancel();
      return { bytes: new Uint8Array(), oversize: true };
    }
    chunks.push(next.value);
    length += next.value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, oversize: false };
}

interface RoomAllocationInput {
  releaseId: string;
  gameSlug: string;
  maxPlayers: number;
  visibility: "private" | "public";
  origin: "hosted" | "quickplay";
  displayName: string;
  now: number;
  creatorUserId: string | null;
  savedSnapshot?: GameSnapshotDto;
  resumedFromSaveId?: string;
}

interface RoomAllocationResult {
  roomId: string;
  joinCode: string;
  playerId: string;
  roomToken: string;
  releaseId: string;
}

async function allocateRoomForPlayer(
  env: Env,
  input: RoomAllocationInput,
): Promise<RoomAllocationResult | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const joinCode = generateJoinCode();
    const id = env.ROOM.newUniqueId();
    const roomId = id.toString();
    try {
      await env.DB.prepare(
        `INSERT INTO rooms_index
          (room_id, join_code, join_code_normalized, visibility, release_id,
           player_count, max_players, created_at, ended_at, origin,
           last_heartbeat_at, game_slug, joinable, creator_user_id, resumed_from_save_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        roomId,
        joinCode,
        normalizeJoinCode(joinCode),
        input.visibility,
        input.releaseId,
        input.maxPlayers,
        input.now,
        input.origin,
        input.now,
        input.gameSlug,
        input.creatorUserId,
        input.resumedFromSaveId ?? null,
      ).run();
    } catch (error) {
      if (isUniqueConstraint(error)) continue;
      throw error;
    }
    const room = env.ROOM.get(id);
    const initialized = input.savedSnapshot === undefined
      ? await room.init(roomId, joinCode, input.releaseId, input.maxPlayers, input.creatorUserId)
      : await room.initFromSave(roomId, joinCode, input.releaseId, input.maxPlayers, input.savedSnapshot, input.creatorUserId);
    if (!initialized) {
      await deleteRoomIndex(env.DB, roomId);
      continue;
    }
    const joined = await room.join(input.displayName, false, input.creatorUserId);
    if (joined.status !== "ok") {
      await deleteRoomIndex(env.DB, roomId);
      continue;
    }
    await updatePlayerCount(env.DB, roomId, joined.playerCount);
    return {
      roomId,
      joinCode,
      playerId: joined.playerId,
      roomToken: joined.roomToken,
      releaseId: joined.releaseId,
    };
  }
  return null;
}

function quickPlayCandidate(row: QuickPlayCandidateRow): QuickPlayCandidate {
  return {
    roomId: row.room_id,
    joinCode: row.join_code,
    playerCount: row.player_count,
    maxPlayers: row.max_players,
    lastHeartbeatAt: row.last_heartbeat_at,
    joinable: row.joinable === 1,
  };
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
    await db.prepare("UPDATE rooms_index SET ended_at = ?, joinable = 0 WHERE room_id = ?").bind(now, roomId).run();
  } catch (error) {
    logIndexCacheFailure("ended_at", roomId, error);
  }
}

async function markRoomIneligible(db: D1Database, roomId: string): Promise<void> {
  try {
    await db.prepare(
      `UPDATE rooms_index
       SET joinable = 0, player_count = CASE WHEN player_count > 0 THEN player_count - 1 ELSE 0 END
       WHERE room_id = ?`,
    ).bind(roomId).run();
  } catch (error) {
    logIndexCacheFailure("joinable", roomId, error);
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
