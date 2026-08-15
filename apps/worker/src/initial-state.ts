import { getBuiltinRelease } from "digipology-demo-games";
import {
  createInitialState,
  type CanonicalGameState,
  type EntityComponents,
  type EntityRecord,
  type RngState,
} from "digipology-kernel";

export interface InitialStatePlayer {
  readonly playerId: string;
  readonly displayName: string;
}

const IDENTITY = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  scale: Object.freeze({ x: 1, y: 1, z: 1 }),
});

const FIRST_DEAL_RNG: RngState = {
  algorithm: "sfc32-v1",
  state: [691055819, 669955037, 591673809, 2646504518],
  draws: 0,
};

const DICE_DASH_RNG: RngState = {
  algorithm: "sfc32-v1",
  state: [272407026, 249763150, 2700400486, 1540153423],
  draws: 0,
};

const ZONE_RUNNER_RNG: RngState = {
  algorithm: "sfc32-v1",
  state: [1831565813, 2976579765, 398764591, 920572347],
  draws: 0,
};

function entity(id: string, components: EntityComponents): EntityRecord {
  return { id, components };
}

function releaseFile(releaseId: string, path: string): string {
  const release = getBuiltinRelease(releaseId);
  const file = release?.files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`Missing ${path} in ${releaseId}`);
  return file.content;
}

function playerRecords(players: readonly InitialStatePlayer[]): CanonicalGameState["players"] {
  const records: CanonicalGameState["players"] = {};
  for (const player of players) {
    records[player.playerId] = { id: player.playerId, name: player.displayName };
  }
  return records;
}

function createFirstDealInitialState(
  releaseId: string,
  players: readonly InitialStatePlayer[],
): CanonicalGameState {
  const runtime = JSON.parse(releaseFile("builtin_first_deal_1", "runtime/game.json")) as {
    cardIds: string[];
    deckId: string;
    handIds: string[];
    settings: { cardsPerPlayer: number };
  };
  const entities: Record<string, EntityRecord> = {};
  entities[runtime.deckId] = entity(runtime.deckId, {
    container: {
      items: [...runtime.cardIds],
      capacity: 52,
      ordering: "stack",
      visibility: "public",
    },
    deck: { enabled: true },
  });
  for (let index = 0; index < runtime.handIds.length; index += 1) {
    const handId = runtime.handIds[index]!;
    entities[handId] = entity(handId, {
      container: {
        items: [],
        capacity: 52,
        ordering: "canonical",
        visibility: `owner:seat_${index + 1}`,
      },
      hand: { owner: `seat_${index + 1}`, canonicalOrder: true },
    });
  }
  for (const cardId of runtime.cardIds) {
    entities[cardId] = entity(cardId, {
      card: { definitionId: `standard_${cardId.slice(5)}`, faceUp: false },
      flippable: { flipped: false },
      grabbable: { enabled: true, heldBy: null },
      transform: IDENTITY,
    });
  }
  return createInitialState({
    releaseId,
    rng: FIRST_DEAL_RNG,
    settings: runtime.settings,
    players: playerRecords(players),
    seats: Object.fromEntries(players.map((player, index) => {
      const seatId = `seat_${index + 1}`;
      return [seatId, { id: seatId, playerId: player.playerId, handId: `hand_${seatId}` }];
    })),
    entities,
    scriptState: { phase: "setup" },
  });
}

function createDiceDashInitialState(
  releaseId: string,
  players: readonly InitialStatePlayer[],
): CanonicalGameState {
  const runtime = JSON.parse(releaseFile(releaseId, "runtime/game.json")) as {
    dieId: string;
    dieFaces?: Array<number | string>;
    rollSource?: { deckId: string; tokenIds: string[] };
    scoreIds: string[];
    settings: { targetScore: number };
    winnerId: string;
  };
  const entities: Record<string, EntityRecord> = {};
  if (runtime.rollSource !== undefined) {
    entities[runtime.rollSource.deckId] = entity(runtime.rollSource.deckId, {
      container: {
        items: [...runtime.rollSource.tokenIds],
        capacity: 6,
        ordering: "stack",
        visibility: "hidden",
      },
      deck: { enabled: true },
    });
    for (let index = 0; index < runtime.rollSource.tokenIds.length; index += 1) {
      const tokenId = runtime.rollSource.tokenIds[index]!;
      const value = index + 1;
      entities[tokenId] = entity(tokenId, {
        counter: { value, default: value, min: value, max: value },
      });
    }
  }
  entities[runtime.dieId] = entity(runtime.dieId, {
    die: {
      definitionId: "standard_d6",
      value: 1,
      ...(runtime.dieFaces === undefined ? {} : { faces: runtime.dieFaces }),
    },
    grabbable: { enabled: true, heldBy: null },
    transform: IDENTITY,
  });
  for (let index = 0; index < runtime.scoreIds.length; index += 1) {
    const scoreId = runtime.scoreIds[index]!;
    entities[scoreId] = entity(scoreId, {
      counter: { value: 0, default: 0, min: 0, max: runtime.settings.targetScore },
      grabbable: { enabled: true, heldBy: null },
      transform: {
        ...IDENTITY,
        position: { x: index * 2, y: 0, z: 0 },
      },
    });
  }
  entities[runtime.winnerId] = entity(runtime.winnerId, {
    counter: { value: 0, default: 0, min: 0, max: 4 },
  });
  return createInitialState({
    releaseId,
    rng: DICE_DASH_RNG,
    settings: runtime.settings,
    players: playerRecords(players),
    seats: Object.fromEntries(players.map((player, index) => {
      const seatId = `seat_${index + 1}`;
      return [seatId, { id: seatId, playerId: player.playerId, scoreId: `score_${seatId}` }];
    })),
    entities,
    scriptState: { gameOver: false },
  });
}

function createZoneRunnerInitialState(
  releaseId: string,
  players: readonly InitialStatePlayer[],
): CanonicalGameState {
  const runtime = JSON.parse(releaseFile(releaseId, "runtime/game.json")) as {
    handIds: string[];
    pieceIds: string[];
    rulesId: string;
    scoreIds: string[];
    settings: { targetScore: number; turnSeconds: number };
    snapPointIds: string[];
    statusId: string;
    zoneId: string;
  };
  const transform = (x: number, z = 0) => ({ ...IDENTITY, position: { x, y: 0, z } });
  const entities: Record<string, EntityRecord> = {};
  entities[runtime.rulesId] = entity(runtime.rulesId, {
    script: { scriptId: "scripts/game.lua", bindingId: "zone_runner_rules", props: { role: "game" } },
  });
  entities[runtime.zoneId] = entity(runtime.zoneId, {
    transform: { ...IDENTITY, scale: { x: 8, y: 2, z: 4 } },
    zone: { shape: "box", acceptedTags: ["runner"], visibleInPlay: true, members: [] },
    script: {
      scriptId: "scripts/game.lua",
      bindingId: "zone_runner_scoring_zone",
      props: { role: "scoring_zone" },
    },
  });
  entities[runtime.statusId] = entity(runtime.statusId, {
    text: { value: "Waiting for runners" },
    transform: transform(0, -3),
  });
  for (let index = 0; index < runtime.snapPointIds.length; index += 1) {
    const id = runtime.snapPointIds[index]!;
    entities[id] = entity(id, {
      transform: transform(-3 + index * 2),
      "snap-point": { radius: 0.75, capacity: 1, tags: ["runner"], alignment: null, attached: [] },
    });
  }
  for (let index = 0; index < runtime.handIds.length; index += 1) {
    const id = runtime.handIds[index]!;
    const seatNumber = index + 1;
    entities[id] = entity(id, {
      container: {
        items: runtime.pieceIds.filter((pieceId) => pieceId.startsWith(`runner_seat_${seatNumber}_`)),
        capacity: 2,
        ordering: "canonical",
        visibility: `owner:seat_${seatNumber}`,
      },
      hand: { owner: `seat_${seatNumber}`, canonicalOrder: true },
    });
  }
  for (let index = 0; index < runtime.pieceIds.length; index += 1) {
    const id = runtime.pieceIds[index]!;
    entities[id] = entity(id, {
      grabbable: { enabled: true, heldBy: null },
      tags: { values: ["runner"] },
      transform: transform(-3.5 + index, 5),
    });
  }
  for (let index = 0; index < runtime.scoreIds.length; index += 1) {
    const id = runtime.scoreIds[index]!;
    entities[id] = entity(id, {
      counter: { value: 0, default: 0, min: 0, max: runtime.settings.targetScore },
      transform: transform(-3 + index * 2, -4),
    });
  }
  return createInitialState({
    releaseId,
    rng: ZONE_RUNNER_RNG,
    settings: runtime.settings,
    players: playerRecords(players),
    seats: Object.fromEntries(players.map((player, index) => {
      const seatId = `seat_${index + 1}`;
      return [seatId, {
        id: seatId,
        playerId: player.playerId,
        handId: `hand_${seatId}`,
        scoreId: `score_${seatId}`,
      }];
    })),
    entities,
  });
}

/** Deterministic starting state for a built-in release, or null for unknown IDs. */
export function createBuiltinInitialState(
  releaseId: string,
  players: readonly InitialStatePlayer[],
): CanonicalGameState | null {
  if (releaseId === "builtin_first_deal_1") {
    return createFirstDealInitialState(releaseId, players);
  }
  if (releaseId === "builtin_dice_dash_1" || releaseId === "builtin_dice_dash_2") {
    return createDiceDashInitialState(releaseId, players);
  }
  if (releaseId === "builtin_zone_runner_1" || releaseId === "builtin_zone_runner_2") {
    return createZoneRunnerInitialState(releaseId, players);
  }
  return null;
}
