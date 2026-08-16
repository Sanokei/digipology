import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getBuiltinRelease } from "digipology-demo-games";
import type { GameSnapshotDto } from "digipology-protocol/http";
import { createSession, type SessionRecord, type SessionRepository } from "./auth";
import { builtinCatalog } from "./catalog";
import { handlePlatformRequest, isCsrfSafe, readCoverBody, readUploadJson, writeReleaseThenCommit } from "./platform";

describe("catalog routes", () => {
  test("serve demo-game summaries, details, and the immutable release bundle", async () => {
    const env = {} as Env;
    const gamesResponse = await handlePlatformRequest(
      new Request("https://play.digipology.com/api/games"),
      env,
    );
    const gamesBody = await gamesResponse.json() as {
      games: Array<{ slug: string; currentPlayers: number; totalPlays: number; coverVersion: number | null }>;
    };
    expect(gamesBody.games.map((game) => game.slug)).toEqual(["first-deal", "dice-dash", "zone-runner"]);
    expect(gamesBody.games[0]).toMatchObject({ currentPlayers: 0, totalPlays: 0, coverVersion: 3 });
    expect(gamesBody.games.every((game) => game.coverVersion === 3)).toBe(true);

    const gameResponse = await handlePlatformRequest(
      new Request("https://play.digipology.com/api/games/dice-dash"),
      env,
    );
    const gameBody = await gameResponse.json() as {
      game: { slug: string };
      latestRelease: { releaseId: string };
    };
    expect(gameBody.game.slug).toBe("dice-dash");
    expect(gameBody.latestRelease.releaseId).toBe("builtin_dice_dash_2");

    const bundleResponse = await handlePlatformRequest(
      new Request("https://play.digipology.com/api/releases/builtin_dice_dash_1/bundle"),
      env,
    );
    const bundle = await bundleResponse.json() as {
      releaseId: string;
      files: unknown[];
      title: string;
      initialSnapshot: { sequence: number; stateHash: string };
    };
    expect(bundle).toMatchObject(
      getBuiltinRelease("builtin_dice_dash_1") as unknown as Record<string, unknown>,
    );
    expect(bundle.releaseId).toBe("builtin_dice_dash_1");
    expect(bundle.files.length).toBeGreaterThan(0);
    expect(bundle.title).toBe("Dice Dash");
    expect(bundle.initialSnapshot.sequence).toBe(0);
    expect(bundle.initialSnapshot.stateHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("interleaves public uploaded games and streams uploaded bundles with immutable headers", async () => {
    const uploadedJson = JSON.stringify({ releaseId: "release_uploaded", initialSnapshot: {} });
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (sql.includes("FROM releases r")) return values[0] === "release_uploaded" ? {
                  id: "release_uploaded", game_id: "game_uploaded", game_slug: "community-dice",
                  game_title: "Community Dice", min_players: 2, max_players: 4, release_number: 1,
                  kernel_version: 1, lua_api_version: 1, manifest_hash: "sha256:" + "0".repeat(64),
                  bundle_key: "releases/release_uploaded.json", status: "ready", created_at: 1,
                } : null;
                return null;
              },
              async all() {
                if (sql.includes("COALESCE(SUM")) return { results: [{
                  slug: "community-dice", current_players: 5, total_plays: 17,
                }] };
                return { results: [] };
              },
            };
          },
          async all() {
            return { results: sql.includes("FROM games g") ? [{
              id: "game_uploaded", slug: "community-dice", title: "Community Dice", tagline: "By players",
              min_players: 2, max_players: 4, owner_user_id: "user_creator", owner_name: "Ada",
              visibility: "public", latest_release_id: "release_uploaded",
              total_plays: 17, cover_version: 3,
            }] : [] };
          },
        };
      },
    } as unknown as D1Database;
    const releases = {
      get: async (key: string) => key === "releases/release_uploaded.json" ? {
        body: new Response(uploadedJson).body,
      } : null,
    } as unknown as R2Bucket;
    const env = { DB: db, RELEASES: releases } as Env;
    const gamesResponse = await handlePlatformRequest(new Request("https://play.digipology.com/api/games"), env);
    const games = await gamesResponse.json() as {
      games: Array<{ slug: string; creatorHandle?: string; currentPlayers: number; totalPlays: number; coverVersion: number | null }>;
    };
    expect(games.games.at(-1)).toEqual(expect.objectContaining({
      slug: "community-dice", creatorHandle: "Ada", currentPlayers: 5, totalPlays: 17, coverVersion: 3,
    }));

    const bundleResponse = await handlePlatformRequest(
      new Request("https://play.digipology.com/api/releases/release_uploaded/bundle"), env,
    );
    expect(await bundleResponse.text()).toBe(uploadedJson);
    expect(bundleResponse.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(bundleResponse.headers.get("Content-Type")).toContain("application/json");
    expect(bundleResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("same-origin custom-header CSRF check", () => {
  test("requires the custom header", () => {
    expect(isCsrfSafe(new Request("https://play.digipology.com/api/me", { method: "PATCH" }))).toBe(false);
  });

  test("accepts a matching origin and rejects a cross origin", () => {
    expect(isCsrfSafe(new Request("https://play.digipology.com/api/me", {
      method: "PATCH",
      headers: { "X-Digipology-CSRF": "1", Origin: "https://play.digipology.com" },
    }))).toBe(true);
    expect(isCsrfSafe(new Request("https://play.digipology.com/api/me", {
      method: "PATCH",
      headers: { "X-Digipology-CSRF": "1", Origin: "https://evil.example" },
    }))).toBe(false);
  });

  test("allows non-browser clients with the custom header and no Origin", () => {
    expect(isCsrfSafe(new Request("http://127.0.0.1:8787/api/rooms", {
      method: "POST",
      headers: { "X-Digipology-CSRF": "1" },
    }))).toBe(true);
  });
});

describe("canonical room timer metadata", () => {
  test("authenticates register and cancel reports through the Room DO", async () => {
    const roomId = "a".repeat(64);
    const calls: unknown[][] = [];
    const room = {
      async scheduleCanonicalTimer(...args: unknown[]) { calls.push(["register", ...args]); return true; },
      async cancelCanonicalTimerForPlayer(...args: unknown[]) { calls.push(["cancel", ...args]); return true; },
    };
    const env = {
      ROOM: {
        idFromString: (value: string) => value,
        get: () => room,
      },
    } as unknown as Env;
    const headers = { "X-Digipology-CSRF": "1", "Content-Type": "application/json" };
    const register = await handlePlatformRequest(new Request(
      `https://play.digipology.com/api/rooms/${roomId}/timers`,
      { method: "POST", headers, body: JSON.stringify({ operation: "register", roomToken: "token", timerId: "timer-1", delay: 2 }) },
    ), env);
    const cancel = await handlePlatformRequest(new Request(
      `https://play.digipology.com/api/rooms/${roomId}/timers`,
      { method: "POST", headers, body: JSON.stringify({ operation: "cancel", roomToken: "token", timerId: "timer-1" }) },
    ), env);
    expect([register.status, cancel.status]).toEqual([204, 204]);
    expect(calls).toEqual([
      ["register", "token", "timer-1", 2],
      ["cancel", "token", "timer-1"],
    ]);
  });
});

describe("scripted checkpoint attestation route", () => {
  test("forwards a size-bounded authenticated attestation to the Room DO", async () => {
    const roomId = "b".repeat(64);
    const calls: unknown[][] = [];
    const room = {
      async attestCheckpoint(...args: unknown[]) {
        calls.push(args);
        return { status: "confirmed" as const };
      },
    };
    const env = {
      ROOM: { idFromString: (value: string) => value, get: () => room },
    } as unknown as Env;
    const snapshot = {
      formatVersion: 1, kernelVersion: 1, releaseId: "release_test", sequence: 200,
      state: { sequence: 200 }, stateHash: `sha256:${"1".repeat(64)}`,
    };
    const response = await handlePlatformRequest(new Request(
      `https://play.digipology.com/api/rooms/${roomId}/checkpoints`,
      {
        method: "POST",
        headers: { "X-Digipology-CSRF": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ roomToken: "room-token", sequence: 200, stateHash: snapshot.stateHash, snapshot }),
      },
    ), env);
    expect(response.status).toBe(204);
    expect(calls).toEqual([["room-token", {
      sequence: 200,
      stateHash: snapshot.stateHash,
      snapshot,
    }]]);
  });

  test("maps unauthenticated, divergent, conflicted, rejected, rate-limited, and oversized reports", async () => {
    const roomId = "c".repeat(64);
    const statuses = ["unauthorized", "divergent", "conflicted", "rejected", "rate_limited"] as const;
    let call = 0;
    const env = {
      ROOM: {
        idFromString: (value: string) => value,
        get: () => ({ attestCheckpoint: async () => ({ status: statuses[call++] }) }),
      },
    } as unknown as Env;
    const headers = { "X-Digipology-CSRF": "1", "Content-Type": "application/json" };
    const body = JSON.stringify({ roomToken: "bad", sequence: 200, stateHash: "hash", snapshot: {} });
    const responses = [];
    for (let index = 0; index < statuses.length; index += 1) {
      responses.push(await handlePlatformRequest(new Request(
        `https://play.digipology.com/api/rooms/${roomId}/checkpoints`,
        { method: "POST", headers, body },
      ), env));
    }
    expect(responses.map((response) => response.status)).toEqual([403, 409, 409, 422, 429]);
    expect(await responses[1]!.json()).toMatchObject({ error: { code: "checkpoint_divergent" } });
    const conflictedBody = await responses[2]!.json() as {
      error: { code: string; message: string };
    };
    expect(conflictedBody).toEqual({
      error: {
        code: "checkpoint_conflicted",
        message: "This checkpoint sequence was already contested; the room will attest a later one",
      },
    });

    const oversized = await handlePlatformRequest(new Request(
      `https://play.digipology.com/api/rooms/${roomId}/checkpoints`,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(1024 * 1024 + 1) },
        body: "{}",
      },
    ), env);
    expect(oversized.status).toBe(413);
  });
});

describe("upload body cap", () => {
  test("uses a 1 MiB route-specific limit without changing existing API bodies", async () => {
    const within = JSON.stringify({ bundle: "x".repeat(8 * 1024) });
    expect(await readUploadJson(new Request("https://play.digipology.com/api/games", {
      method: "POST", body: within,
    }))).toMatchObject({ oversize: false, value: { bundle: expect.any(String) } });
    expect(await readUploadJson(new Request("https://play.digipology.com/api/games", {
      method: "POST", body: "{}", headers: { "Content-Length": String(1024 * 1024 + 1) },
    }))).toMatchObject({ oversize: true, value: null });
  });

  test("rejects cover bodies above 512 KiB before buffering them", async () => {
    expect(await readCoverBody(new Request("https://play.digipology.com/api/games/community/cover", {
      method: "POST",
      body: new Uint8Array([1]).buffer,
      headers: { "Content-Length": String(512 * 1024 + 1) },
    }))).toEqual({ bytes: new Uint8Array(), oversize: true });
  });
});

describe("quick play route", () => {
  test("joins a fresh room as an auto-named guest and returns its join code", async () => {
    let joinedName = "";
    let requiredJoinable = false;
    const statements: string[] = [];
    const db = quickPlayDb([{ room_id: "a".repeat(64), join_code: "ABCD-2345", player_count: 3,
      max_players: 4, last_heartbeat_at: Date.now(), joinable: 1 }], [], statements);
    const room = {
      join: async (name: string, requireQuickPlayJoinable: boolean) => {
        joinedName = name;
        requiredJoinable = requireQuickPlayJoinable;
        return { status: "ok" as const, playerId: "player_guest", roomToken: "token", releaseId: "builtin_dice_dash_2", playerCount: 4 };
      },
    };
    const env = {
      DB: db,
      ROOM: {
        idFromString: (value: string) => ({ toString: () => value }),
        get: () => room,
      },
    } as unknown as Env;
    const response = await handlePlatformRequest(new Request("https://play.digipology.com/api/quickplay", {
      method: "POST",
      headers: { "X-Digipology-CSRF": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "dice-dash" }),
    }), env);
    expect(response.status).toBe(200);
    expect(joinedName).toMatch(/^Guest-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(requiredJoinable).toBe(true);
    expect(statements.filter((sql) => sql.includes("rooms_index") && sql.includes("joinable = 1")))
      .toHaveLength(2);
    expect(await response.json()).toMatchObject({
      roomId: "a".repeat(64), joinCode: "ABCD-2345", releaseId: "builtin_dice_dash_2",
    });
  });

  test("creates a public system-owned quickplay room when no candidate survives", async () => {
    const inserts: unknown[][] = [];
    const db = quickPlayDb([], inserts);
    const id = { toString: () => "b".repeat(64) };
    const room = {
      init: async () => true,
      join: async () => ({
        status: "ok" as const, playerId: "player_new", roomToken: "token",
        releaseId: "builtin_first_deal_1", playerCount: 1,
      }),
    };
    const env = {
      DB: db,
      ROOM: { newUniqueId: () => id, get: () => room },
    } as unknown as Env;
    const response = await handlePlatformRequest(new Request("https://play.digipology.com/api/quickplay", {
      method: "POST",
      headers: { "X-Digipology-CSRF": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "first-deal", displayName: "Visitor" }),
    }), env);
    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual(expect.arrayContaining(["public", "quickplay", "first-deal"]));
    expect(await response.json()).toMatchObject({ roomId: "b".repeat(64), releaseId: "builtin_first_deal_1" });
  });
});

describe("release publish ordering", () => {
  test("does not insert a release or move its pointer when R2 fails", async () => {
    let committed = false;
    const bucket = {
      put: async () => { throw new Error("simulated R2 failure"); },
    } as unknown as R2Bucket;
    await expect(writeReleaseThenCommit(bucket, "releases/release_1.json", "{}", async () => {
      committed = true;
    })).rejects.toThrow("simulated R2 failure");
    expect(committed).toBe(false);
  });
});

describe("uploaded game authorization", () => {
  test("requires authentication on every uploaded-game mutation and My Games", async () => {
    const headers = { "X-Digipology-CSRF": "1" };
    for (const [method, path] of [
      ["POST", "/api/games"],
      ["POST", "/api/games/community/releases"],
      ["PATCH", "/api/games/community"],
    ] as const) {
      const response = await handlePlatformRequest(new Request(`https://play.digipology.com${path}`, {
        method, headers,
      }), {} as Env);
      expect(response.status).toBe(401);
    }
    expect((await handlePlatformRequest(
      new Request("https://play.digipology.com/api/games/mine"), {} as Env,
    )).status).toBe(401);
  });

  test("rejects a signed-in non-owner and keeps built-ins immutable", async () => {
    const { env, cookie } = await authenticatedTestEnv("user_other");
    const headers = { "X-Digipology-CSRF": "1", Cookie: cookie };
    expect((await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community/releases", { method: "POST", headers },
    ), env)).status).toBe(403);
    expect((await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community", { method: "PATCH", headers },
    ), env)).status).toBe(403);
    expect((await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/first-deal", { method: "PATCH", headers },
    ), env)).status).toBe(404);
  });

  test("enforces cover ownership and serves a valid versioned raster round-trip", async () => {
    const anon = await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community/cover",
      { method: "POST", headers: { "X-Digipology-CSRF": "1" } },
    ), {} as Env);
    expect(anon.status).toBe(401);

    const nonOwner = await authenticatedTestEnv("user_other");
    expect((await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community/cover",
      { method: "POST", headers: { "X-Digipology-CSRF": "1", Cookie: nonOwner.cookie } },
    ), nonOwner.env)).status).toBe(403);
    expect((await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/first-deal/cover",
      { method: "POST", headers: { "X-Digipology-CSRF": "1", Cookie: nonOwner.cookie } },
    ), nonOwner.env)).status).toBe(403);

    const owner = await authenticatedTestEnv("user_owner");
    let stored: Uint8Array | null = null;
    let puts = 0;
    const bucket = {
      async put(_key: string, value: Uint8Array) { puts += 1; stored = value; return {}; },
      async get() {
        return stored === null ? null : {
          body: new Response(stored.buffer as ArrayBuffer).body,
          httpMetadata: { contentType: "image/png" },
          httpEtag: '"cover-etag"',
        };
      },
    } as unknown as R2Bucket;
    owner.env.RELEASES = bucket;
    const rejected = await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community/cover",
      {
        method: "POST",
        headers: { "X-Digipology-CSRF": "1", Cookie: owner.cookie, "Content-Type": "image/jpeg" },
        body: minimalPng(336, 504).buffer as ArrayBuffer,
      },
    ), owner.env);
    expect(rejected.status).toBe(422);
    expect(puts).toBe(0);
    const upload = await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community/cover",
      {
        method: "POST",
        headers: { "X-Digipology-CSRF": "1", Cookie: owner.cookie, "Content-Type": "image/png" },
        body: minimalPng(336, 504).buffer as ArrayBuffer,
      },
    ), owner.env);
    expect(upload.status).toBe(200);
    expect(puts).toBe(1);
    expect(await upload.json<{ coverVersion: number }>()).toEqual({ coverVersion: 1 });

    const served = await handlePlatformRequest(new Request(
      "https://play.digipology.com/api/games/community/cover?v=1",
    ), owner.env);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(served.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await served.arrayBuffer()))).toEqual(Array.from(minimalPng(336, 504)));
  });

  test("serves bespoke built-in SVG covers through the same endpoint", async () => {
    for (const slug of ["first-deal", "dice-dash", "zone-runner"]) {
      const response = await handlePlatformRequest(new Request(
        `https://play.digipology.com/api/games/${slug}/cover?v=3`,
      ), {} as Env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
      expect(await response.text()).toContain('width="336" height="504"');
    }
  });
});

describe("saved tables routes", () => {
  test("require authentication for save, list, delete, and resume", async () => {
    const roomId = "d".repeat(64);
    for (const [method, path, body] of [
      ["POST", `/api/rooms/${roomId}/save`, { roomToken: "host-token" }],
      ["GET", "/api/saves", undefined],
      ["DELETE", "/api/saves/save_private", undefined],
      ["POST", "/api/saves/save_private/resume", {}],
    ] as const) {
      const response = await handlePlatformRequest(savedTablesRequest(method, path, undefined, body), {} as Env);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "authentication_required" } });
    }
  });

  test("maps save token, host, availability, and freshness failures", async () => {
    const harness = await savedTablesTestEnv();
    const absent = await harness.request("POST", `/api/rooms/${harness.roomId}/save`, {});
    expect(absent.status).toBe(403);
    expect(await absent.json()).toMatchObject({ error: { code: "save_unauthorized" } });

    for (const [token, outcome, code] of [
      ["bad-token", { status: "unauthorized" }, "save_unauthorized"],
      ["player-token", { status: "host_only" }, "save_host_only"],
      ["host-token", { status: "unavailable" }, "save_unavailable"],
      ["host-token", { status: "unavailable" }, "save_unavailable"],
      ["host-token", { status: "stale" }, "save_stale"],
    ] as const) {
      harness.saveOutcome = outcome;
      const response = await harness.request("POST", `/api/rooms/${harness.roomId}/save`, { roomToken: token });
      expect(response.status).toBe(code.startsWith("save_") && code !== "save_unauthorized" && code !== "save_host_only" ? 409 : 403);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(harness.bucket.objects.size).toBe(0);
    expect(harness.db.query("SELECT COUNT(*) AS count FROM saved_tables").get()).toEqual({ count: 0 });
  });

  test("rejects tampered and oversized snapshots without persistence", async () => {
    const harness = await savedTablesTestEnv();
    harness.saveOutcome = { status: "invalid", reason: "Snapshot state hash mismatch" };
    const tampered = await harness.request("POST", `/api/rooms/${harness.roomId}/save`, {
      roomToken: "host-token",
      snapshot: { ...harness.snapshot, stateHash: `sha256:${"0".repeat(64)}` },
    });
    expect(tampered.status).toBe(422);
    expect(await tampered.json()).toMatchObject({ error: { code: "save_invalid" } });
    expect(harness.bucket.objects.size).toBe(0);
    expect(harness.db.query("SELECT COUNT(*) AS count FROM saved_tables").get()).toEqual({ count: 0 });

    const oversized = await handlePlatformRequest(new Request(
      `https://play.digipology.com/api/rooms/${harness.roomId}/save`,
      {
        method: "POST",
        headers: savedTablesHeaders(harness.cookie, { "Content-Length": String(1024 * 1024 + 1) }),
        body: "{}",
      },
    ), harness.env, { now: SAVED_TABLES_NOW });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "save_too_large" } });
    expect(harness.bucket.objects.size).toBe(0);
  });

  test("enforces the per-minute rate limit and active-save cap", async () => {
    const rateHarness = await savedTablesTestEnv();
    rateHarness.saveOutcome = { status: "host_only" };
    for (let index = 0; index < 10; index += 1) {
      expect((await rateHarness.request("POST", `/api/rooms/${rateHarness.roomId}/save`, {
        roomToken: "player-token",
      })).status).toBe(403);
    }
    const limited = await rateHarness.request("POST", `/api/rooms/${rateHarness.roomId}/save`, {
      roomToken: "player-token",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

    const capHarness = await savedTablesTestEnv();
    for (let index = 0; index < 50; index += 1) {
      insertSavedTable(capHarness.db, {
        id: `save_cap_${index}`, ownerUserId: capHarness.userId, releaseId: harnessReleaseId(),
        gameSlug: "first-deal", createdAt: index,
      });
    }
    const capped = await capHarness.request("POST", `/api/rooms/${capHarness.roomId}/save`, {
      roomToken: "host-token",
    });
    expect(capped.status).toBe(409);
    expect(await capped.json()).toMatchObject({ error: { code: "save_limit_reached" } });
    expect(capHarness.bucket.objects.size).toBe(0);
  });

  test("persists a verified snapshot and pinned metadata on success", async () => {
    const harness = await savedTablesTestEnv();
    harness.saveOutcome = { status: "ok", snapshotJson: JSON.stringify(harness.snapshot) };
    const response = await harness.request("POST", `/api/rooms/${harness.roomId}/save`, {
      roomToken: "host-token", label: "Friday table", snapshot: harness.snapshot,
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { saveId: string; sequence: number; stateHash: string; createdAt: string };
    expect(body).toMatchObject({ sequence: harness.snapshot.sequence, stateHash: harness.snapshot.stateHash });
    expect(body.saveId).toMatch(/^save_[0-9a-f-]{36}$/);
    expect(Date.parse(body.createdAt)).toBe(SAVED_TABLES_NOW);
    const objectKey = `saves/${body.saveId}.json`;
    expect(JSON.parse(harness.bucket.objects.get(objectKey)!)).toEqual(harness.snapshot);
    expect(harness.db.query(`SELECT id, owner_user_id, release_id, game_slug, source_room_id,
      sequence, state_hash, object_key, label, deleted_at FROM saved_tables WHERE id = ?`).get(body.saveId)).toEqual({
      id: body.saveId, owner_user_id: harness.userId, release_id: harness.snapshot.releaseId,
      game_slug: "first-deal", source_room_id: harness.roomId, sequence: harness.snapshot.sequence,
      state_hash: harness.snapshot.stateHash, object_key: objectKey, label: "Friday table", deleted_at: null,
    });
  });

  test("lists only the owner's active saves newest first with resolved and fallback titles", async () => {
    const harness = await savedTablesTestEnv();
    addTestUser(harness.db, "user_other");
    insertUploadedRelease(harness.db, "release_community", "ready");
    insertSavedTable(harness.db, {
      id: "save_builtin", ownerUserId: harness.userId, releaseId: harnessReleaseId(),
      gameSlug: "first-deal", createdAt: 100,
    });
    insertSavedTable(harness.db, {
      id: "save_uploaded", ownerUserId: harness.userId, releaseId: "release_community",
      gameSlug: "community", createdAt: 200,
    });
    insertSavedTable(harness.db, {
      id: "save_fallback", ownerUserId: harness.userId, releaseId: "release_missing",
      gameSlug: "lost-game", createdAt: 300,
    });
    insertSavedTable(harness.db, {
      id: "save_deleted", ownerUserId: harness.userId, releaseId: harnessReleaseId(),
      gameSlug: "first-deal", createdAt: 400, deletedAt: 401,
    });
    insertSavedTable(harness.db, {
      id: "save_other", ownerUserId: "user_other", releaseId: harnessReleaseId(),
      gameSlug: "first-deal", createdAt: 500,
    });

    const response = await harness.request("GET", "/api/saves");
    expect(response.status).toBe(200);
    const body = await response.json() as { saves: Array<{ saveId: string; gameTitle: string }> };
    expect(body.saves).toEqual([
      expect.objectContaining({ saveId: "save_fallback", gameTitle: "lost-game" }),
      expect.objectContaining({ saveId: "save_uploaded", gameTitle: "Community Game" }),
      expect.objectContaining({ saveId: "save_builtin", gameTitle: "First Deal" }),
    ]);
  });

  test("soft-deletes only an owner's save and removes its R2 object", async () => {
    const harness = await savedTablesTestEnv();
    const otherCookie = await addTestSession(harness.db, "user_other", SAVED_TABLES_NOW);
    insertSavedTable(harness.db, {
      id: "save_delete", ownerUserId: harness.userId, releaseId: harnessReleaseId(),
      gameSlug: "first-deal", createdAt: 100,
    });
    harness.bucket.objects.set("saves/save_delete.json", JSON.stringify(harness.snapshot));

    const hidden = await handlePlatformRequest(
      savedTablesRequest("DELETE", "/api/saves/save_delete", otherCookie),
      harness.env,
      { now: SAVED_TABLES_NOW },
    );
    expect(hidden.status).toBe(404);
    expect(harness.bucket.objects.has("saves/save_delete.json")).toBe(true);

    const deleted = await harness.request("DELETE", "/api/saves/save_delete");
    expect(deleted.status).toBe(204);
    expect(harness.bucket.objects.has("saves/save_delete.json")).toBe(false);
    expect(harness.db.query("SELECT deleted_at FROM saved_tables WHERE id = 'save_delete'").get())
      .toEqual({ deleted_at: SAVED_TABLES_NOW });
    const listed = await harness.request("GET", "/api/saves");
    expect(await listed.json() as { saves: unknown[] }).toEqual({ saves: [] });
  });

  test("does not leak foreign saves and resumes available saves into a new indexed room", async () => {
    const harness = await savedTablesTestEnv();
    const otherCookie = await addTestSession(harness.db, "user_other", SAVED_TABLES_NOW);
    insertUploadedRelease(harness.db, "release_disabled", "disabled");
    insertSavedTable(harness.db, {
      id: "save_disabled", ownerUserId: harness.userId, releaseId: "release_disabled",
      gameSlug: "community", createdAt: 100,
    });
    insertSavedTable(harness.db, {
      id: "save_missing", ownerUserId: harness.userId, releaseId: "release_missing",
      gameSlug: "missing", createdAt: 101,
    });
    insertSavedTable(harness.db, {
      id: "save_resume", ownerUserId: harness.userId, releaseId: harnessReleaseId(),
      gameSlug: "first-deal", createdAt: 102, stateHash: harness.snapshot.stateHash,
      sequence: harness.snapshot.sequence,
    });
    harness.bucket.objects.set("saves/save_resume.json", JSON.stringify(harness.snapshot));

    const foreign = await handlePlatformRequest(
      savedTablesRequest("POST", "/api/saves/save_resume/resume", otherCookie, {}),
      harness.env,
      { now: SAVED_TABLES_NOW },
    );
    expect(foreign.status).toBe(404);
    for (const saveId of ["save_disabled", "save_missing"]) {
      const unavailable = await harness.request("POST", `/api/saves/${saveId}/resume`, {});
      expect(unavailable.status).toBe(410);
      expect(await unavailable.json()).toMatchObject({ error: { code: "release_unavailable" } });
    }

    const resumed = await harness.request("POST", "/api/saves/save_resume/resume", {
      visibility: "private", displayName: "Resuming Host",
    });
    expect(resumed.status).toBe(201);
    const body = await resumed.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      roomId: harness.newRoomId, playerId: "player_resumed", roomToken: "resumed-token",
      releaseId: harnessReleaseId(), gameTitle: "First Deal",
    });
    expect(body.joinCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(body.inviteUrl).toBe(`https://play.digipology.com/join/${body.joinCode}`);
    expect(body.wsUrl).toBe(`wss://play.digipology.com/api/rooms/${harness.newRoomId}/ws`);
    expect(harness.initializedFromSave).toEqual(harness.snapshot);
    expect(harness.db.query(`SELECT room_id, release_id, origin, creator_user_id,
      resumed_from_save_id FROM rooms_index WHERE room_id = ?`).get(harness.newRoomId)).toEqual({
      room_id: harness.newRoomId, release_id: harnessReleaseId(), origin: "hosted",
      creator_user_id: harness.userId, resumed_from_save_id: "save_resume",
    });
  });
});

describe("end table route", () => {
  test("requires a host token and reports an already-ended table", async () => {
    const harness = await savedTablesTestEnv();
    for (const [body, code] of [
      [{}, "end_unauthorized"],
      [{ roomToken: "bad-token" }, "end_unauthorized"],
      [{ roomToken: "player-token" }, "end_host_only"],
    ] as const) {
      const response = await harness.request("POST", `/api/rooms/${harness.roomId}/end`, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect((await harness.request("POST", `/api/rooms/${harness.roomId}/end`, {
      roomToken: "host-token",
    })).status).toBe(204);
    const ended = await harness.request("POST", `/api/rooms/${harness.roomId}/end`, {
      roomToken: "host-token",
    });
    expect(ended.status).toBe(409);
    expect(await ended.json()).toMatchObject({ error: { code: "end_unavailable" } });
  });
});

const SAVED_TABLES_NOW = Date.parse("2026-08-16T12:00:00.000Z");
const TEST_SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";

type TestSaveOutcome =
  | { status: "unauthorized" | "host_only" | "unavailable" | "stale" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; snapshotJson: string };

class SqliteD1Statement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly values: readonly unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, values);
  }

  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.db.query(this.sql).get(...this.values as never[]) as Record<string, unknown> | null;
    if (row === null) return null;
    return (columnName === undefined ? row : row[columnName]) as T;
  }

  async all<T>(): Promise<{ success: true; results: T[]; meta: { changes: number } }> {
    const rows = this.db.query(this.sql).all(...this.values as never[]) as T[];
    return { success: true, results: rows, meta: { changes: 0 } };
  }

  async run<T>(): Promise<{ success: true; results: T[]; meta: { changes: number } }> {
    if (/\bRETURNING\b/i.test(this.sql)) {
      const rows = this.db.query(this.sql).all(...this.values as never[]) as T[];
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const result = this.db.query(this.sql).run(...this.values as never[]);
    return { success: true, results: [], meta: { changes: result.changes } };
  }
}

function sqliteD1(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(db, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) {
        results.push(await (statement as unknown as SqliteD1Statement).run());
      }
      return results;
    },
  } as unknown as D1Database;
}

class MemorySaveBucket {
  readonly objects = new Map<string, string>();

  async put(key: string, value: string): Promise<object> {
    this.objects.set(key, value);
    return {};
  }

  async get(key: string): Promise<object | null> {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      body: new Response(value).body,
      text: async () => value,
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

interface SavedTablesTestHarness {
  db: Database;
  env: Env;
  bucket: MemorySaveBucket;
  cookie: string;
  userId: string;
  roomId: string;
  newRoomId: string;
  snapshot: GameSnapshotDto;
  saveOutcome: TestSaveOutcome;
  initializedFromSave: GameSnapshotDto | null;
  request(method: string, path: string, body?: unknown): Promise<Response>;
}

async function savedTablesTestEnv(): Promise<SavedTablesTestHarness> {
  const db = new Database(":memory:");
  for (const name of [
    "0001_platform_v1.sql", "0002_uploaded_games_v1.sql",
    "0003_quickplay_metrics_covers.sql", "0004_deepseek_usage.sql",
    "0005_room_joinability.sql", "0006_saved_tables.sql",
  ]) db.exec(await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text());
  const userId = "user_owner";
  const cookie = await addTestSession(db, userId, SAVED_TABLES_NOW);
  const roomId = "d".repeat(64);
  const newRoomId = "e".repeat(64);
  db.query(`INSERT INTO rooms_index
    (room_id, join_code, join_code_normalized, visibility, release_id,
     player_count, max_players, created_at, ended_at, origin,
     last_heartbeat_at, game_slug, joinable, creator_user_id, resumed_from_save_id)
    VALUES (?, 'AAAA-2222', 'AAAA2222', 'private', ?, 1, 4, ?, NULL,
            'hosted', ?, 'first-deal', 1, ?, NULL)`)
    .run(roomId, harnessReleaseId(), SAVED_TABLES_NOW, SAVED_TABLES_NOW, userId);
  const release = builtinCatalog.getRelease(harnessReleaseId());
  if (release === null) throw new Error("Missing saved-tables test release");
  const snapshot = structuredClone(release.bundle.initialSnapshot);
  const bucket = new MemorySaveBucket();
  const harness = {
    db,
    bucket,
    cookie,
    userId,
    roomId,
    newRoomId,
    snapshot,
    saveOutcome: { status: "ok", snapshotJson: JSON.stringify(snapshot) } as TestSaveOutcome,
    initializedFromSave: null,
  } as SavedTablesTestHarness;
  let ended = false;
  const room = {
    async saveSnapshot(_roomToken: string, _snapshot?: GameSnapshotDto) {
      return harness.saveOutcome;
    },
    async endWithToken(roomToken: string) {
      if (roomToken === "bad-token") return "unauthorized" as const;
      if (roomToken === "player-token") return "host_only" as const;
      if (ended) return "unavailable" as const;
      ended = true;
      return "ended" as const;
    },
    async initFromSave(
      _roomId: string,
      _joinCode: string,
      _releaseId: string,
      _capacity: number,
      saved: GameSnapshotDto,
    ) {
      harness.initializedFromSave = saved;
      return true;
    },
    async join() {
      return {
        status: "ok" as const,
        playerId: "player_resumed",
        roomToken: "resumed-token",
        releaseId: harnessReleaseId(),
        playerCount: 1,
      };
    },
  };
  harness.env = {
    DB: sqliteD1(db),
    RELEASES: bucket as unknown as R2Bucket,
    SESSION_SECRET: TEST_SESSION_SECRET,
    ROOM: {
      idFromString: (value: string) => value,
      newUniqueId: () => ({ toString: () => newRoomId }),
      get: () => room,
    },
  } as unknown as Env;
  harness.request = (method, path, body) => handlePlatformRequest(
    savedTablesRequest(method, path, cookie, body),
    harness.env,
    { now: SAVED_TABLES_NOW },
  );
  return harness;
}

function savedTablesHeaders(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Digipology-CSRF": "1",
    "Content-Type": "application/json",
    ...(cookie === undefined ? {} : { Cookie: cookie }),
    ...extra,
  };
}

function savedTablesRequest(method: string, path: string, cookie?: string, body?: unknown): Request {
  return new Request(`https://play.digipology.com${path}`, {
    method,
    headers: savedTablesHeaders(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addTestSession(db: Database, userId: string, now: number): Promise<string> {
  addTestUser(db, userId);
  let record: SessionRecord | null = null;
  const repository: SessionRepository = {
    insertSession(value) { record = value; return Promise.resolve(); },
    findSessions() { return Promise.resolve([]); },
    refreshSession() { return Promise.resolve(true); },
    revokeSession() { return Promise.resolve(true); },
  };
  const created = await createSession(repository, {
    id: userId,
    name: userId === "user_owner" ? "Owner" : "Other",
    email: `${userId}@example.com`,
  }, TEST_SESSION_SECRET, now);
  const session = record! as SessionRecord;
  db.query(`INSERT INTO sessions
    (id, user_id, token_selector, token_hash, created_at, last_used_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`).run(
    session.id, session.user.id, session.tokenSelector, session.tokenHash,
    session.createdAt, session.lastUsedAt, session.expiresAt,
  );
  return `dgp_session=${created.token}`;
}

function addTestUser(db: Database, userId: string): void {
  db.query(`INSERT OR IGNORE INTO users (id, name, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    userId,
    userId === "user_owner" ? "Owner" : "Other",
    `${userId}@example.com`,
    SAVED_TABLES_NOW,
    SAVED_TABLES_NOW,
  );
}

function insertSavedTable(db: Database, input: {
  id: string;
  ownerUserId: string;
  releaseId: string;
  gameSlug: string;
  createdAt: number;
  sequence?: number;
  stateHash?: string;
  deletedAt?: number;
}): void {
  db.query(`INSERT INTO saved_tables
    (id, owner_user_id, release_id, game_slug, source_room_id, sequence,
     state_hash, object_key, byte_length, label, created_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, NULL, ?, ?)`)
    .run(
      input.id,
      input.ownerUserId,
      input.releaseId,
      input.gameSlug,
      "source_room",
      input.sequence ?? 0,
      input.stateHash ?? `sha256:${"1".repeat(64)}`,
      `saves/${input.id}.json`,
      input.createdAt,
      input.deletedAt ?? null,
    );
}

function insertUploadedRelease(db: Database, releaseId: string, status: string): void {
  db.query(`INSERT OR IGNORE INTO games
    (id, slug, title, tagline, min_players, max_players, builtin, latest_release_id,
     created_at, updated_at, owner_user_id, visibility, total_plays, cover_version)
    VALUES ('game_community', 'community', 'Community Game', '', 2, 6, 0, ?,
            ?, ?, 'user_owner', 'public', 0, NULL)`)
    .run(releaseId, SAVED_TABLES_NOW, SAVED_TABLES_NOW);
  db.query(`INSERT INTO releases
    (id, game_id, release_number, kernel_version, lua_api_version, manifest_hash,
     status, created_at, format_version, network_protocol_version, bundle_key)
    VALUES (?, 'game_community', 1, 1, 1, ?, ?, ?, 1, 1, ?)`)
    .run(releaseId, `sha256:${"2".repeat(64)}`, status, SAVED_TABLES_NOW, `releases/${releaseId}.json`);
}

function harnessReleaseId(): string {
  return "builtin_first_deal_1";
}

function quickPlayDb(
  rows: unknown[],
  inserts: unknown[][] = [],
  statements: string[] = [],
): D1Database {
  return {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...values: unknown[]) {
          return {
            async all() {
              return { results: sql.includes("FROM rooms_index") ? rows : [] };
            },
            async run() {
              if (sql.includes("INSERT INTO rooms_index")) inserts.push(values);
              return { success: true, meta: { changes: 1 }, results: [] };
            },
            async first() { return null; },
          };
        },
      };
    },
    async batch() {
      return [
        { success: true, meta: { changes: 0 }, results: [] },
        { success: true, meta: { changes: 1 }, results: [{ count: 1 }] },
      ];
    },
  } as unknown as D1Database;
}

function minimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

async function authenticatedTestEnv(userId: string): Promise<{ env: Env; cookie: string }> {
  let record: SessionRecord | null = null;
  let storedCoverVersion: number | null = null;
  const repository: SessionRepository = {
    insertSession(value) { record = value; return Promise.resolve(); },
    findSessions() { return Promise.resolve([]); },
    refreshSession() { return Promise.resolve(true); },
    revokeSession() { return Promise.resolve(true); },
  };
  const secret = "test-session-secret-that-is-at-least-32-bytes";
  const created = await createSession(repository, { id: userId, name: "Other", email: "other@example.com" }, secret, Date.now());
  const session = record! as SessionRecord;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all() {
              if (sql.includes("FROM sessions s")) return { results: [{
                id: session.id, token_selector: session.tokenSelector, token_hash: session.tokenHash,
                created_at: session.createdAt, last_used_at: session.lastUsedAt, expires_at: session.expiresAt,
                revoked_at: null, user_id: session.user.id, user_name: session.user.name, user_email: session.user.email,
              }] };
              return { results: [] };
            },
            async first() {
              if (sql.includes("UPDATE sessions SET last_used_at")) return { id: session.id };
              if (sql.includes("FROM games g") && values[0] === "community") return {
                id: "game_community", slug: "community", title: "Community", tagline: "",
                min_players: 2, max_players: 4, owner_user_id: "user_owner", owner_name: "Owner",
                visibility: "public", latest_release_id: "release_community",
                total_plays: 0, cover_version: storedCoverVersion,
              };
              if (sql.includes("UPDATE games SET cover_version") && userId === "user_owner") {
                storedCoverVersion = 1;
                return { cover_version: storedCoverVersion };
              }
              return null;
            },
          };
        },
      };
    },
    async batch() {
      return [
        { success: true, meta: { changes: 0 }, results: [] },
        { success: true, meta: { changes: 1 }, results: [{ count: 1 }] },
      ];
    },
  } as unknown as D1Database;
  return {
    env: { DB: db, SESSION_SECRET: secret } as unknown as Env,
    cookie: `dgp_session=${created.token}`,
  };
}
