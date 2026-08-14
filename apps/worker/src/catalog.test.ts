import { describe, expect, test } from "bun:test";
import { getBuiltinRelease } from "digipology-demo-games";
import { loadSnapshot, snapshot, type GameSnapshot } from "digipology-kernel";
import { builtinCatalog, gameSummary, releaseSummary } from "./catalog";
import { createBuiltinInitialState } from "./initial-state";

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
    for (const name of [
      "first-deal-replay-v1",
      "dice-dash-replay-v1",
      "dice-dash-replay-v2",
    ]) {
      const fixture = await Bun.file(
        new URL(`../../../packages/demo-games/fixtures/${name}.json`, import.meta.url),
      ).json() as { initialSnapshot: GameSnapshot };
      fixtureHashes[fixture.initialSnapshot.releaseId] = fixture.initialSnapshot.stateHash;
    }
    for (const releaseId of Object.keys(fixtureHashes)) {
      const bundle = builtinCatalog.getRelease(releaseId)?.bundle as unknown as {
        initialSnapshot?: GameSnapshot;
      };
      const initialSnapshot = bundle.initialSnapshot;
      expect(initialSnapshot).toBeDefined();
      const state = loadSnapshot(initialSnapshot!);
      expect(state.sequence).toBe(0);
      expect(state.releaseId).toBe(releaseId);
      expect(initialSnapshot!.stateHash).toBe(fixtureHashes[releaseId]!);
    }
  });

  test("builds a valid room snapshot from the live roster and deterministic seats", () => {
    const roster = [
      { playerId: "player_host", displayName: "Host" },
      { playerId: "player_guest", displayName: "Guest" },
    ];
    const state = createBuiltinInitialState("builtin_dice_dash_2", roster)!;
    expect(loadSnapshot(snapshot(state))).toEqual(state);
    expect(state.players).toEqual({
      player_host: { id: "player_host", name: "Host" },
      player_guest: { id: "player_guest", name: "Guest" },
    });
    expect(state.seats).toEqual({
      seat_1: { id: "seat_1", playerId: "player_host", scoreId: "score_seat_1" },
      seat_2: { id: "seat_2", playerId: "player_guest", scoreId: "score_seat_2" },
    });
  });

  test("keeps v1 resolvable while new Dice Dash rooms pin v2", () => {
    expect(builtinCatalog.getGame("dice-dash")?.latestReleaseId).toBe("builtin_dice_dash_2");
    expect(builtinCatalog.getRelease("builtin_dice_dash_1")?.releaseId).toBe(
      "builtin_dice_dash_1",
    );
    expect(builtinCatalog.resolveRelease("dice-dash")?.releaseId).toBe(
      "builtin_dice_dash_2",
    );
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
      currentPlayers: 0,
      totalPlays: 0,
      coverVersion: 1,
    });
    expect(releaseSummary(release)).toEqual({
      releaseId: "builtin_first_deal_1",
      kernelVersion: 1,
      luaApiVersion: 1,
    });
  });
});
