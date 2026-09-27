import { DICE_DASH_LUA } from "./game.lua";
import { DICE_DASH_V2_LUA } from "./game-v2.lua";
import { DICE_DASH_RUNTIME_JSON } from "./runtime";
import { DICE_DASH_V2_RUNTIME_JSON } from "./runtime-v2";
import type { BuiltinGame, ReleaseBundle } from "../../types";

const release1: ReleaseBundle = {
  formatVersion: 1, gameId: "builtin_dice_dash", releaseId: "builtin_dice_dash_1", releaseNumber: 1,
  kernelVersion: 1, luaApiVersion: 1, networkProtocolVersion: 1, interactionMode: "scripted", minPlayers: 2, maxPlayers: 4,
  files: [
    { path: "runtime/game.json", contentHash: "sha256:43a5ae597a71efa62fa4f38c92c602689d5682812e5028d331fd64a7ab5374e1", byteLength: 350, content: DICE_DASH_RUNTIME_JSON },
    { path: "scripts/game.lua", contentHash: "sha256:f446463ed0b1911a87318f16a894574388ce5e2bfcd91b687bb7b70a7b30ee31", byteLength: 568, content: DICE_DASH_LUA },
  ], integrity: { manifestHash: "sha256:f672353e5b6df79aa7157e9bd8a4eb9802e30991b1cc1adf07a25a3e015e0b12" },
};
const release2: ReleaseBundle = {
  formatVersion: 1, gameId: "builtin_dice_dash", releaseId: "builtin_dice_dash_2", releaseNumber: 2,
  kernelVersion: 1, luaApiVersion: 1, networkProtocolVersion: 1, interactionMode: "scripted", minPlayers: 2, maxPlayers: 4,
  files: [
    { path: "runtime/game.json", contentHash: "sha256:a5f0259d78641823e42fca96a5473d7dac4d15caeebcd22997543c48d27fa889", byteLength: 283, content: DICE_DASH_V2_RUNTIME_JSON },
    { path: "scripts/game.lua", contentHash: "sha256:11609e827351dcde8f3a671de5a104b62f8fced3dc56f3842a03c3f47cd849e5", byteLength: 615, content: DICE_DASH_V2_LUA },
  ], integrity: { manifestHash: "sha256:5aaa27904e5ae552314a5c6d6ffded1a1babb19fce94a8acf10877355fa3d02c" },
};

export const DICE_DASH_GAME: BuiltinGame = {
  slug: "dice-dash", title: "Dice Dash", tagline: "Race to 20 on deterministic rolls from the shared table.",
  minPlayers: 2, maxPlayers: 4,
  coverSpec: { palette: ["#0b0b0f", "#f3a53b", "#22c55e", "#f3f3f5"], layout: "diagonal", motif: "dice", titleTreatment: "boxed", seed: 4_204_202 },
  latestReleaseId: release2.releaseId, releases: [release1, release2],
};
