import { FIRST_DEAL_LUA } from "./game.lua";
import { FIRST_DEAL_RUNTIME_JSON } from "./runtime";
import type { BuiltinGame, ReleaseBundle } from "../../types";

const release: ReleaseBundle = {
  formatVersion: 1, gameId: "builtin_first_deal", releaseId: "builtin_first_deal_1", releaseNumber: 1,
  kernelVersion: 1, luaApiVersion: 1, networkProtocolVersion: 1, interactionMode: "sandbox",
  minPlayers: 2, maxPlayers: 4,
  files: [
    { path: "runtime/game.json", contentHash: "sha256:7c2da5b4569c825288e795c49d09cb50ea108d0a1232d7eb00e7b8d2402fd17b", byteLength: 784, content: FIRST_DEAL_RUNTIME_JSON },
    { path: "scripts/game.lua", contentHash: "sha256:ee16ea328bed23363b889e8ae4f52ff7075be1599a93cc09859b7d7e72ba8a7f", byteLength: 530, content: FIRST_DEAL_LUA },
  ],
  integrity: { manifestHash: "sha256:28e79d8c4c4f5c60154e21ed7784b68de7f025c3df9f0badc6deb4aff5a2c0ea" },
};

export const FIRST_DEAL_GAME: BuiltinGame = {
  slug: "first-deal", title: "First Deal",
  tagline: "Shuffle, deal, draw, flip, and move a full deck together.",
  minPlayers: 2, maxPlayers: 4,
  coverSpec: { palette: ["#0b0b0f", "#f3a53b", "#8b5cf6", "#f3f3f5"], layout: "banded", motif: "cards", titleTreatment: "underlined", seed: 1_031_991 },
  latestReleaseId: release.releaseId, releases: [release],
};
