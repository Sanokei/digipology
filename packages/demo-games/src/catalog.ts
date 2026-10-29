import { DICE_DASH_LUA } from "./games/dice-dash/game.lua";
import { DICE_DASH_V2_LUA } from "./games/dice-dash/game-v2.lua";
import { DICE_DASH_V3_LUA } from "./games/dice-dash/game-v3.lua";
import { DICE_DASH_V3_RUNTIME_JSON } from "./games/dice-dash/runtime-v3";
import { DICE_DASH_RUNTIME_JSON } from "./games/dice-dash/runtime";
import { DICE_DASH_V2_RUNTIME_JSON } from "./games/dice-dash/runtime-v2";
import { FIRST_DEAL_LUA } from "./games/first-deal/game.lua";
import { FIRST_DEAL_RUNTIME_JSON } from "./games/first-deal/runtime";
import { FIRST_DEAL_V2_RUNTIME_JSON } from "./games/first-deal/runtime-v2";
import { FIRST_DEAL_V2_CARDS_JSON, FIRST_DEAL_V2_DEFINITIONS } from "./games/first-deal/cards-v2";
import { FIRST_DEAL_V2_RULES } from "./games/first-deal/rules-v2";
import { FIRST_DEAL_V2_LUA } from "./games/first-deal/game-v2.lua";
import { ZONE_RUNNER_LUA } from "./games/zone-runner/game.lua";
import { ZONE_RUNNER_V2_LUA } from "./games/zone-runner/game-v2.lua";
import { ZONE_RUNNER_RUNTIME_JSON } from "./games/zone-runner/runtime";
import { ZONE_RUNNER_V2_RUNTIME_JSON } from "./games/zone-runner/runtime-v2";
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

const FIRST_DEAL_RELEASE_V2 = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_first_deal",
  releaseId: "builtin_first_deal_2",
  releaseNumber: 2,
  kernelVersion: 1,
  luaApiVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "sandbox",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:085b530c01a54235cf349fff60b394247bc359814e2e4f8b80e736a9fa07a782",
      byteLength: 1299,
      content: FIRST_DEAL_V2_RUNTIME_JSON,
    }),
    frozenFile({
      path: "runtime/cards.json",
      contentHash: "sha256:fef6d9661641563edfc017e0dbc348e4c196a8e4379f9e5755715e03de620fa7",
      byteLength: 7777,
      content: FIRST_DEAL_V2_CARDS_JSON,
    }),
    frozenFile({
      path: "runtime/rules.md",
      contentHash: "sha256:68515aca2418c543e44bcfd56d22a812e8f61ccdf09a489a47541277f0a6a44e",
      byteLength: 1263,
      content: FIRST_DEAL_V2_RULES,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:c2f6477ac523668e778719c32e29d73ca3bd36456d88417b3edbf2a454ea36e0",
      byteLength: 217,
      content: FIRST_DEAL_V2_LUA,
    }),
  ],
  definitions: FIRST_DEAL_V2_DEFINITIONS,
  integrity: Object.freeze({ manifestHash: "sha256:03a1ff5756409d5fc12832ed334d2c89d61a8e1dffac8412fc0e70c173e89132" }),
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

const DICE_DASH_RELEASE_V2 = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_dice_dash",
  releaseId: "builtin_dice_dash_2",
  releaseNumber: 2,
  kernelVersion: 1,
  luaApiVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "scripted",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:a5f0259d78641823e42fca96a5473d7dac4d15caeebcd22997543c48d27fa889",
      byteLength: 283,
      content: DICE_DASH_V2_RUNTIME_JSON,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:11609e827351dcde8f3a671de5a104b62f8fced3dc56f3842a03c3f47cd849e5",
      byteLength: 615,
      content: DICE_DASH_V2_LUA,
    }),
  ],
  integrity: Object.freeze({
    manifestHash: "sha256:5aaa27904e5ae552314a5c6d6ffded1a1babb19fce94a8acf10877355fa3d02c",
  }),
});

const ZONE_RUNNER_RELEASE = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_zone_runner",
  releaseId: "builtin_zone_runner_1",
  releaseNumber: 1,
  kernelVersion: 1,
  luaApiVersion: 1,
  luaStdlibVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "scripted",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:ebe2862a41cedb2714e72faa2a744c910deeaaabdad43e95157c03f3412d39c9",
      byteLength: 575,
      content: ZONE_RUNNER_RUNTIME_JSON,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:938a20e78d2cf0e9e0b6e4a7e9ff48c3c620379a9c502ff9194ffc5dd2918606",
      byteLength: 2170,
      content: ZONE_RUNNER_LUA,
    }),
  ],
  definitions: Object.freeze({
    runner: Object.freeze({ label: "Runner", color: "#f3a53b" }),
  }),
  refs: Object.freeze({
    status: "status",
  }),
  integrity: Object.freeze({
    manifestHash: "sha256:5b9d3ecc68a79acdd3e6a981a8f6cb5ddedf5c4d82c3b3a688100fb9b056eadc",
  }),
});

const ZONE_RUNNER_RELEASE_V2 = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_zone_runner",
  releaseId: "builtin_zone_runner_2",
  releaseNumber: 2,
  kernelVersion: 1,
  luaApiVersion: 1,
  luaStdlibVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "scripted",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:76cc1e256d588d79b9d28b391b03767278f7e318e60d87958b4f9ae22e653a11",
      byteLength: 576,
      content: ZONE_RUNNER_V2_RUNTIME_JSON,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:65845fd593b3b9c9df3a325b1b853c12f757658039548a8e16acdab70b62b6df",
      byteLength: 2170,
      content: ZONE_RUNNER_V2_LUA,
    }),
  ],
  definitions: Object.freeze({
    runner: Object.freeze({ label: "Runner", color: "#f3a53b" }),
  }),
  refs: Object.freeze({
    status: "status",
  }),
  integrity: Object.freeze({
    manifestHash: "sha256:df7d80b6d1a6f7d94bc04b02cc0aa9ac4bc8ecc98bb0364597eaee95f41d04a4",
  }),
});

const DICE_DASH_RELEASE_V3 = frozenRelease({
  formatVersion: 1,
  gameId: "builtin_dice_dash",
  releaseId: "builtin_dice_dash_3",
  releaseNumber: 3,
  kernelVersion: 1,
  luaApiVersion: 1,
  luaStdlibVersion: 1,
  networkProtocolVersion: 1,
  interactionMode: "scripted",
  minPlayers: 2,
  maxPlayers: 4,
  files: [
    frozenFile({
      path: "runtime/game.json",
      contentHash: "sha256:0ffb53c11f3b4f19c0aff2cd8af22cdf2c8a5387286fadfbcc43788e3a11d201",
      byteLength: 255,
      content: DICE_DASH_V3_RUNTIME_JSON,
    }),
    frozenFile({
      path: "scripts/game.lua",
      contentHash: "sha256:5db197a2755c4add135fa0a7ec552e6a43c9d45e196bbd7c0441113c0c943b10",
      byteLength: 1295,
      content: DICE_DASH_V3_LUA,
    }),
  ],
  definitions: Object.freeze({ standard_d6: Object.freeze({ label: "Die", color: "#f4c46b" }) }),
  refs: Object.freeze({ status: "status" }),
  integrity: Object.freeze({ manifestHash: "sha256:d14ff78a0bf4e2d117adff593cc1596daaca43ef8def4b7b1b1b34e1e89959af" }),
});

export const BUILTIN_GAMES: ReadonlyArray<BuiltinGame> = Object.freeze([
  Object.freeze({
    slug: "first-deal",
    title: "First Deal",
    tagline: "Shuffle, deal, draw, flip, and move a full deck together.",
    minPlayers: 2,
    maxPlayers: 4,
    latestReleaseId: FIRST_DEAL_RELEASE_V2.releaseId,
    releases: Object.freeze([FIRST_DEAL_RELEASE, FIRST_DEAL_RELEASE_V2]),
  }),
  Object.freeze({
    slug: "dice-dash",
    title: "Dice Dash",
    tagline: "Race to 20 on deterministic rolls from the shared table.",
    minPlayers: 2,
    maxPlayers: 4,
    latestReleaseId: DICE_DASH_RELEASE_V3.releaseId,
    releases: Object.freeze([DICE_DASH_RELEASE, DICE_DASH_RELEASE_V2, DICE_DASH_RELEASE_V3]),
  }),
  Object.freeze({
    slug: "zone-runner",
    title: "Zone Runner",
    tagline: "Race pieces into scoring zones before the turn timer runs out.",
    minPlayers: 2,
    maxPlayers: 4,
    latestReleaseId: ZONE_RUNNER_RELEASE_V2.releaseId,
    releases: Object.freeze([ZONE_RUNNER_RELEASE, ZONE_RUNNER_RELEASE_V2]),
  }),
]);

export function getBuiltinRelease(releaseId: string): ReleaseBundle | undefined {
  for (const game of BUILTIN_GAMES) {
    const release = game.releases.find((candidate) => candidate.releaseId === releaseId);
    if (release !== undefined) return release;
  }
  return undefined;
}
