import { describe, expect, it } from "bun:test";

import { createApiClient, CSRF_HEADER } from "./client";

describe("API client", () => {
  it("uses the ADR route shapes, cookies, JSON, and CSRF header", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const client = createApiClient(async (input, init) => {
      calls.push([input, init]);
      return new Response(null, { status: 204 });
    });

    await client.requestLink("ada@example.com");
    const [path, init] = calls[0] ?? [];
    expect(path).toBe("/api/auth/request-link");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get(CSRF_HEADER)).toBe("1");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ email: "ada@example.com" }));
  });

  it("does not add CSRF to GET and URL-encodes route parameters", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const client = createApiClient(async (input, init) => {
      calls.push([input, init]);
      return Response.json({ game: {}, latestRelease: {} });
    });
    await client.getGame("cards / test");
    const [path, init] = calls[0] ?? [];
    expect(path).toBe("/api/games/cards%20%2F%20test");
    expect(new Headers(init?.headers).has(CSRF_HEADER)).toBe(false);
    expect(init?.credentials).toBe("include");
  });

  it("maps structured and network errors to typed results", async () => {
    const structured = createApiClient(async () => Response.json(
      { error: { code: "full", message: "Room is full" } },
      { status: 409 },
    ));
    expect(await structured.joinRoom({ code: "ABCD-EFGH" })).toEqual({
      ok: false,
      error: { code: "full", message: "Room is full", status: 409 },
    });

    const validation = createApiClient(async () => Response.json({
      error: { code: "validation_failed", message: "Invalid bundle" },
      report: [{ check: "manifest_hash", ok: false, detail: "expected hash" }],
    }, { status: 422 }));
    expect(await validation.createRelease("demo", {} as never)).toMatchObject({
      ok: false,
      error: { code: "validation_failed", status: 422, report: [{ check: "manifest_hash", ok: false }] },
    });

    const aiFailure = createApiClient(async () => Response.json({
      error: { code: "ai_generation_failed", message: "Try again" },
      validationReport: [{ check: "kernel_load", ok: false, detail: "invalid state" }],
      telemetry: { attempts: 3 },
    }, { status: 502 }));
    expect(await aiFailure.createAiGame("make a game")).toMatchObject({
      ok: false,
      error: { code: "ai_generation_failed", status: 502, report: [{ check: "kernel_load", ok: false }] },
    });

    const offline = createApiClient(async () => { throw new Error("offline"); });
    expect(await offline.me()).toMatchObject({ ok: false, error: { code: "network_error" } });
  });

  it("covers every remaining route", async () => {
    const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
    const client = createApiClient(async (input, init) => {
      calls.push({ path: String(input), init });
      if (String(input).endsWith("logout")) return new Response(null, { status: 204 });
      return Response.json({ user: null, games: [], rooms: [] });
    });
    await client.logout(); await client.me(); await client.patchMe("Ada");
    await client.listGames(); await client.listMyGames();
    await client.createGame({ title: "Demo", tagline: "", minPlayers: 2, maxPlayers: 4, bundle: {} as never });
    await client.createRelease("demo game", {} as never);
    await client.createAiGame("Make a card game");
    await client.editAiGame("demo game", "Add a timer");
    await client.updateGameVisibility("demo game", "unlisted");
    await client.createRoom({ releaseSlugOrId: "demo", visibility: "private", displayName: "Ada" });
    await client.joinRoom({ code: "ABCD-EFGH", displayName: "Grace" }); await client.listPublicRooms();
    await client.quickPlay({ slug: "demo game", displayName: "Grace" });
    await client.getReleaseBundle("rel/1");
    expect(calls.map(({ path, init }) => [path, init?.method])).toEqual([
      ["/api/auth/logout", "POST"], ["/api/me", "GET"], ["/api/me", "PATCH"],
      ["/api/games", "GET"], ["/api/games/mine", "GET"], ["/api/games", "POST"],
      ["/api/games/demo%20game/releases", "POST"], ["/api/ai/games", "POST"],
      ["/api/ai/games/demo%20game/edit", "POST"], ["/api/games/demo%20game", "PATCH"],
      ["/api/rooms", "POST"], ["/api/rooms/join", "POST"],
      ["/api/rooms/public", "GET"], ["/api/quickplay", "POST"],
      ["/api/releases/rel%2F1/bundle", "GET"],
    ]);
    for (const { init } of calls) {
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).has(CSRF_HEADER)).toBe(init?.method !== "GET");
    }
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ name: "Ada" }));
    expect(calls[7]?.init?.body).toBe(JSON.stringify({ prompt: "Make a card game" }));
    expect(calls[8]?.init?.body).toBe(JSON.stringify({ instruction: "Add a timer" }));
    expect(calls[10]?.init?.body).toBe(JSON.stringify({ releaseSlugOrId: "demo", visibility: "private", displayName: "Ada" }));
    expect(calls[11]?.init?.body).toBe(JSON.stringify({ code: "ABCD-EFGH", displayName: "Grace" }));
    expect(calls[13]?.init?.body).toBe(JSON.stringify({ slug: "demo game", displayName: "Grace" }));
  });
});
