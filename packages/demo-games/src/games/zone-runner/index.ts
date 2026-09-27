import { ZONE_RUNNER_LUA } from "./game.lua";
import { ZONE_RUNNER_V2_LUA } from "./game-v2.lua";
import { ZONE_RUNNER_RUNTIME_JSON } from "./runtime";
import { ZONE_RUNNER_V2_RUNTIME_JSON } from "./runtime-v2";
import type { BuiltinGame, ReleaseBundle } from "../../types";

const definitions = { runner: { label: "Runner", color: "#f3a53b" } };
const refs = { status: "status" };
const release1: ReleaseBundle = {
  formatVersion: 1, gameId: "builtin_zone_runner", releaseId: "builtin_zone_runner_1", releaseNumber: 1,
  kernelVersion: 1, luaApiVersion: 1, luaStdlibVersion: 1, networkProtocolVersion: 1, interactionMode: "scripted", minPlayers: 2, maxPlayers: 4,
  files: [
    { path: "runtime/game.json", contentHash: "sha256:ebe2862a41cedb2714e72faa2a744c910deeaaabdad43e95157c03f3412d39c9", byteLength: 575, content: ZONE_RUNNER_RUNTIME_JSON },
    { path: "scripts/game.lua", contentHash: "sha256:938a20e78d2cf0e9e0b6e4a7e9ff48c3c620379a9c502ff9194ffc5dd2918606", byteLength: 2170, content: ZONE_RUNNER_LUA },
  ], definitions, refs, integrity: { manifestHash: "sha256:5b9d3ecc68a79acdd3e6a981a8f6cb5ddedf5c4d82c3b3a688100fb9b056eadc" },
};
const release2: ReleaseBundle = {
  formatVersion: 1, gameId: "builtin_zone_runner", releaseId: "builtin_zone_runner_2", releaseNumber: 2,
  kernelVersion: 1, luaApiVersion: 1, luaStdlibVersion: 1, networkProtocolVersion: 1, interactionMode: "scripted", minPlayers: 2, maxPlayers: 4,
  files: [
    { path: "runtime/game.json", contentHash: "sha256:76cc1e256d588d79b9d28b391b03767278f7e318e60d87958b4f9ae22e653a11", byteLength: 576, content: ZONE_RUNNER_V2_RUNTIME_JSON },
    { path: "scripts/game.lua", contentHash: "sha256:65845fd593b3b9c9df3a325b1b853c12f757658039548a8e16acdab70b62b6df", byteLength: 2170, content: ZONE_RUNNER_V2_LUA },
  ], definitions, refs, integrity: { manifestHash: "sha256:df7d80b6d1a6f7d94bc04b02cc0aa9ac4bc8ecc98bb0364597eaee95f41d04a4" },
};

export const ZONE_RUNNER_GAME: BuiltinGame = {
  slug: "zone-runner", title: "Zone Runner", tagline: "Race pieces into scoring zones before the turn timer runs out.",
  minPlayers: 2, maxPlayers: 4,
  coverSpec: { palette: ["#0b0b0f", "#f3a53b", "#38bdf8", "#f3f3f5"], layout: "radial", motif: "meeples", titleTreatment: "stacked", seed: 6_600_166 },
  latestReleaseId: release2.releaseId, releases: [release1, release2],
};
