import { DICE_DASH_LUA } from "./games/dice-dash/game.lua";
import { DICE_DASH_RUNTIME_JSON } from "./games/dice-dash/runtime";
import { FIRST_DEAL_LUA } from "./games/first-deal/game.lua";
import { FIRST_DEAL_RUNTIME_JSON } from "./games/first-deal/runtime";
import type { BuiltinGame, ReleaseBundle, ReleaseFile } from "./types";

function frozenFile(file: ReleaseFile): ReleaseFile {
  return Object.freeze(file);
}

function frozenRelease(release: ReleaseBundle): ReleaseBundle {
  Object.freeze(release.files);
  Object.freeze(release.integrity);
  return Object.freeze(release);
}

const FIRST_DEAL_RELEASE = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_first_deal",
  releaseId: "builtin_first_deal_1",
  releaseNumber: 1,
  kernelVersion: 1,
  luaApiVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "sandbox",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:7c2da5b4569c825288e795c49d09cb50ea108d0a1232d7eb00e7b8d2402fd17b",
      byteLength: 784,
      content: FIRST_DEAL_RUNTIME_JSON,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:ee16ea328bed23363b889e8ae4f52ff7075be1599a93cc09859b7d7e72ba8a7f",
      byteLength: 530,
      content: FIRST_DEAL_LUA,
    }),
  ],
  integrity: Object.freeze({
    manifestHash: "sha256:28e79d8c4c4f5c60154e21ed7784b68de7f025c3df9f0badc6deb4aff5a2c0ea",
  }),
});

const DICE_DASH_RELEASE = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_dice_dash",
  releaseId: "builtin_dice_dash_1",
  releaseNumber: 1,
  kernelVersion: 1,
  luaApiVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "scripted",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:43a5ae597a71efa62fa4f38c92c602689d5682812e5028d331fd64a7ab5374e1",
      byteLength: 350,
      content: DICE_DASH_RUNTIME_JSON,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:f446463ed0b1911a87318f16a894574388ce5e2bfcd91b687bb7b70a7b30ee31",
      byteLength: 568,
      content: DICE_DASH_LUA,
    }),
  ],
  integrity: Object.freeze({
    manifestHash: "sha256:f672353e5b6df79aa7157e9bd8a4eb9802e30991b1cc1adf07a25a3e015e0b12",
  }),
});

export const BUILTIN_GAMES: ReadonlyArray<BuiltinGame> = Object.freeze([
  Object.freeze({
    slug: "first-deal",
    title: "First Deal",
    tagline: "Shuffle, deal, draw, flip, and move a full deck together.",
    minPlayers: 2,
    maxPlayers: 4,
    release: FIRST_DEAL_RELEASE,
  }),
  Object.freeze({
    slug: "dice-dash",
    title: "Dice Dash",
    tagline: "Race to 20 on deterministic rolls from the shared table.",
    minPlayers: 2,
    maxPlayers: 4,
    release: DICE_DASH_RELEASE,
  }),
]);

export function getBuiltinRelease(releaseId: string): ReleaseBundle | undefined {
  return BUILTIN_GAMES.find((game) => game.release.releaseId === releaseId)?.release;
}
