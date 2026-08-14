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
  return null;
}
