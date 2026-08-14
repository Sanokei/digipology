import { describe, expect, test } from "bun:test";
import { getBuiltinRelease } from "digipology-demo-games";
import { builtinCatalog, gameSummary, releaseSummary } from "./catalog";

describe("built-in game catalog", () => {
  test("lists both demo games and resolves their slugs and immutable release IDs", () => {
    const games = builtinCatalog.listGames();
    expect(games.map((game) => game.slug)).toEqual(["first-deal", "dice-dash"]);

    for (const game of games) {
      const bySlug = builtinCatalog.resolveRelease(game.slug);
      const byId = builtinCatalog.resolveRelease(game.latestReleaseId);
      expect(bySlug).toBe(byId);
      expect(byId?.bundle as unknown).toBe(getBuiltinRelease(game.latestReleaseId) as unknown);
    }
  });

  test("projects exact API summary shapes", () => {
    const game = builtinCatalog.getGame("first-deal")!;
    const release = builtinCatalog.getRelease(game.latestReleaseId)!;
    expect(gameSummary(game)).toEqual({
      slug: "first-deal",
      title: "First Deal",
      tagline: "Shuffle, deal, draw, flip, and move a full deck together.",
      minPlayers: 2,
      maxPlayers: 4,
      builtin: true,
    });
    expect(releaseSummary(release)).toEqual({
      releaseId: "builtin_first_deal_1",
      kernelVersion: 1,
      luaApiVersion: 1,
    });
  });
});
