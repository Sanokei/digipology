import { describe, expect, test } from "bun:test";
import { getBuiltinRelease } from "digipology-demo-games";
import { handlePlatformRequest, isCsrfSafe } from "./platform";

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
    expect(gameBody.latestRelease.releaseId).toBe("builtin_dice_dash_1");

    const bundleResponse = await handlePlatformRequest(
      new Request("https://play.digipology.com/api/releases/builtin_dice_dash_1/bundle"),
      env,
    );
    const bundle = await bundleResponse.json() as { releaseId: string; files: unknown[] };
    expect(bundle).toEqual(
      getBuiltinRelease("builtin_dice_dash_1") as unknown as typeof bundle,
    );
    expect(bundle.releaseId).toBe("builtin_dice_dash_1");
    expect(bundle.files.length).toBeGreaterThan(0);
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
