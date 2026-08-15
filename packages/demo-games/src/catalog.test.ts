import { describe, expect, test } from "bun:test";
import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import { defaultActionRegistry } from "digipology-kernel";
import { createSandbox } from "digipology-lua";
import firstDealFixture from "../fixtures/first-deal-replay-v1.json";
import diceDashFixture from "../fixtures/dice-dash-replay-v1.json";
import diceDashV2Fixture from "../fixtures/dice-dash-replay-v2.json";
import packageJson from "../package.json";
import { BUILTIN_GAMES, getBuiltinRelease } from "./index";
import type { ReleaseBundle } from "./types";

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    }
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function rawHash(value: string): string {
  let hex = "";
  for (const byte of sha256(encodeUtf8(value))) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `sha256:${hex}`;
}

function manifestHashInput(release: ReleaseBundle) {
  return {
    formatVersion: release.formatVersion,
    gameId: release.gameId,
    releaseId: release.releaseId,
    releaseNumber: release.releaseNumber,
    kernelVersion: release.kernelVersion,
    luaApiVersion: release.luaApiVersion,
    networkProtocolVersion: release.networkProtocolVersion,
    interactionMode: release.interactionMode,
    minPlayers: release.minPlayers,
    maxPlayers: release.maxPlayers,
    files: release.files.map(({ path, contentHash, byteLength }) => ({
      path,
      contentHash,
      byteLength,
    })),
  };
}

function validateManifestShape(release: ReleaseBundle): void {
  expect(release.formatVersion).toBe(1);
  expect(release.gameId).toMatch(/^builtin_[a-z_]+$/);
  expect(release.releaseId).toMatch(/^builtin_[a-z_]+_[1-9][0-9]*$/);
  expect(release.releaseNumber).toBeGreaterThanOrEqual(1);
  expect(release.kernelVersion).toBe(1);
  expect(release.luaApiVersion).toBe(1);
  expect(release.networkProtocolVersion).toBe(1);
  expect(["sandbox", "scripted"]).toContain(release.interactionMode);
  expect(release.minPlayers).toBe(2);
  expect(release.maxPlayers).toBe(4);
  expect(release.files.length).toBeGreaterThan(0);
  expect(new Set(release.files.map((file) => file.path)).size).toBe(release.files.length);
  for (const file of release.files) {
    expect(file.path).toMatch(/^(runtime|scripts)\/[a-z.]+$/);
    expect(file.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(file.byteLength).toBeGreaterThan(0);
    expect(typeof file.content).toBe("string");
  }
  expect(release.integrity.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(() => canonicalStringify(manifestHashInput(release))).not.toThrow();
}

describe("built-in catalog", () => {
  test("exports all immutable releases and points Dice Dash at v2", () => {
    expect(
      BUILTIN_GAMES.map(({ slug, latestReleaseId, releases }) => [
        slug,
        latestReleaseId,
        releases.map((release) => release.releaseId),
      ]),
    ).toEqual([
      ["first-deal", "builtin_first_deal_1", ["builtin_first_deal_1"]],
      [
        "dice-dash",
        "builtin_dice_dash_2",
        ["builtin_dice_dash_1", "builtin_dice_dash_2"],
      ],
    ]);
    for (const game of BUILTIN_GAMES) {
      const latest = getBuiltinRelease(game.latestReleaseId)!;
      expect(game.minPlayers).toBe(latest.minPlayers);
      expect(game.maxPlayers).toBe(latest.maxPlayers);
      expect(Object.isFrozen(game)).toBe(true);
      expect(Object.isFrozen(game.releases)).toBe(true);
      for (const release of game.releases) {
        expect(getBuiltinRelease(release.releaseId)).toBe(release);
        expect(Object.isFrozen(release)).toBe(true);
        expect(Object.isFrozen(release.files)).toBe(true);
      }
    }
    expect(getBuiltinRelease("builtin_dice_dash_1")?.integrity.manifestHash).toBe(
      "sha256:f672353e5b6df79aa7157e9bd8a4eb9802e30991b1cc1adf07a25a3e015e0b12",
    );
    expect(getBuiltinRelease("missing_release")).toBeUndefined();
  });

  test("has no runtime dependencies and only the allowed workspace dev dependencies", () => {
    expect("dependencies" in packageJson).toBe(false);
    expect(packageJson.devDependencies).toEqual({
      "digipology-canonical-json": "workspace:*",
      "digipology-kernel": "workspace:*",
      "digipology-lua": "workspace:*",
    });
  });
});

describe("release integrity", () => {
  for (const game of BUILTIN_GAMES) {
    for (const release of game.releases) {
      test(`${release.releaseId} validates and matches every committed hash`, () => {
        validateManifestShape(release);
        for (const file of release.files) {
          expect(encodeUtf8(file.content)).toHaveLength(file.byteLength);
          expect(rawHash(file.content)).toBe(file.contentHash);
        }
        expect(hashValue(manifestHashInput(release))).toBe(
          release.integrity.manifestHash,
        );
      });
    }
  }
});

describe("merged action and Lua surfaces", () => {
  test("every golden action type is in the real kernel registry", () => {
    const registered = new Set(defaultActionRegistry.types());
    const used = [
      ...firstDealFixture.actions,
      ...diceDashFixture.actions,
      ...diceDashV2Fixture.actions,
    ]
      .map((ordered) => ordered.action.type);
    expect(registered).toEqual(new Set([
      "button.press",
      "container.move",
      "counter.add",
      "counter.set",
      "deck.draw_to_container",
      "deck.shuffle",
      "die.roll",
      "entity.drop",
      "entity.flip",
      "entity.grab",
      "entity.move",
      "entity.set_locked",
      "snap.attach",
      "stack.add",
      "stack.create",
      "stack.dissolve",
      "stack.merge",
      "stack.remove_top",
      "system.game_start",
      "system.player_joined",
      "system.player_left",
      "system.seat_assign",
      "text.set",
    ]));
    for (const type of used) expect(registered.has(type)).toBe(true);
  });

  test("all committed Lua sources load in the real hostile-input sandbox", async () => {
    for (const game of BUILTIN_GAMES) {
      for (const release of game.releases) {
        const source = release.files.find(
          (file) => file.path === "scripts/game.lua",
        )?.content;
        expect(source).toBeDefined();
        const lua = await createSandbox({
          instructionBudget: 50_000,
          memoryBudgetBytes: 512 * 1024,
        });
        expect(await lua.run(source!)).toEqual({});
        lua.close();
      }
    }
  });
});
