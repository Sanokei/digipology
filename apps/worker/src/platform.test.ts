import { describe, expect, test } from "bun:test";
import { getBuiltinRelease } from "digipology-demo-games";
import { createSession, type SessionRecord, type SessionRepository } from "./auth";
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
    expect(gamesBody.games.map((game) => game.slug)).toEqual(["first-deal", "dice-dash"]);
    expect(gamesBody.games[0]).toMatchObject({ currentPlayers: 0, totalPlays: 0, coverVersion: 2 });

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
    for (const slug of ["first-deal", "dice-dash"]) {
      const response = await handlePlatformRequest(new Request(
        `https://play.digipology.com/api/games/${slug}/cover?v=1`,
      ), {} as Env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
      expect(await response.text()).toContain('width="336" height="504"');
    }
  });
});

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
