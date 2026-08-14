import { describe, expect, test } from "bun:test";
import { getBuiltinRelease } from "digipology-demo-games";
import { createSession, type SessionRecord, type SessionRepository } from "./auth";
import { handlePlatformRequest, isCsrfSafe, readUploadJson, writeReleaseThenCommit } from "./platform";

describe("catalog routes", () => {
  test("serve demo-game summaries, details, and the immutable release bundle", async () => {
    const env = {} as Env;
    const gamesResponse = await handlePlatformRequest(
      new Request("https://play.digipology.com/api/games"),
      env,
    );
    const gamesBody = await gamesResponse.json() as { games: Array<{ slug: string }> };
    expect(gamesBody.games.map((game) => game.slug)).toEqual(["first-deal", "dice-dash"]);

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
              async all() { return { results: [] }; },
            };
          },
          async all() {
            return { results: sql.includes("FROM games g") ? [{
              id: "game_uploaded", slug: "community-dice", title: "Community Dice", tagline: "By players",
              min_players: 2, max_players: 4, owner_user_id: "user_creator", owner_name: "Ada",
              visibility: "public", latest_release_id: "release_uploaded",
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
    const games = await gamesResponse.json() as { games: Array<{ slug: string; creatorHandle?: string }> };
    expect(games.games.at(-1)).toEqual(expect.objectContaining({ slug: "community-dice", creatorHandle: "Ada" }));

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
});

async function authenticatedTestEnv(userId: string): Promise<{ env: Env; cookie: string }> {
  let record: SessionRecord | null = null;
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
              };
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return {
    env: { DB: db, SESSION_SECRET: secret } as unknown as Env,
    cookie: `dgp_session=${created.token}`,
  };
}
