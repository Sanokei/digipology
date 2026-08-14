import { describe, expect, test } from "bun:test";
import { getBuiltinRelease } from "digipology-demo-games";
import { loadSnapshot, type GameSnapshot } from "digipology-kernel";
import { builtinCatalog, gameSummary, releaseSummary } from "./catalog";

describe("built-in game catalog", () => {
  test("lists both demo games and resolves their slugs and immutable release IDs", () => {
    const games = builtinCatalog.listGames();
    expect(games.map((game) => game.slug)).toEqual(["first-deal", "dice-dash"]);

    for (const game of games) {
      const bySlug = builtinCatalog.resolveRelease(game.slug);
      const byId = builtinCatalog.resolveRelease(game.latestReleaseId);
      expect(bySlug).toBe(byId);
      const release = getBuiltinRelease(game.latestReleaseId)!;
      expect(byId?.bundle).toMatchObject({
        releaseId: release.releaseId,
        files: release.files,
        integrity: release.integrity,
        title: game.title,
      });
    }
  });

  test("serves the golden-fixture initial snapshot in every bundle", async () => {
    const fixtureHashes: Record<string, string> = {};
    for (const name of ["first-deal-replay-v1", "dice-dash-replay-v1"]) {
      const fixture = await Bun.file(
        new URL(`../../../packages/demo-games/fixtures/${name}.json`, import.meta.url),
      ).json() as { initialSnapshot: GameSnapshot };
      fixtureHashes[fixture.initialSnapshot.releaseId] = fixture.initialSnapshot.stateHash;
    }
    for (const game of builtinCatalog.listGames()) {
      const bundle = builtinCatalog.getRelease(game.latestReleaseId)?.bundle as {
        initialSnapshot?: GameSnapshot;
      };
      const initialSnapshot = bundle.initialSnapshot;
      expect(initialSnapshot).toBeDefined();
      const state = loadSnapshot(initialSnapshot!);
      expect(state.sequence).toBe(0);
      expect(state.releaseId).toBe(game.latestReleaseId);
      expect(initialSnapshot!.stateHash).toBe(fixtureHashes[game.latestReleaseId]!);
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
