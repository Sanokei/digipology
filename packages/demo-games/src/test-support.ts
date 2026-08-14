import {
  createInitialState,
  type CanonicalGameState,
  type EntityComponents,
  type EntityRecord,
  type GameSnapshot,
  type OrderedActionInput,
  type RngState,
} from "digipology-kernel";
import { createSandbox, type LuaValue, type Sandbox } from "digipology-lua";
import { getBuiltinRelease } from "./catalog";

export interface LuaExpectation {
  readonly beforeSequence: number;
  readonly callback: "on_start" | "on_after_shuffle" | "on_roll" | "on_after_roll";
  readonly actionSequences: ReadonlyArray<number>;
  readonly seatNumber?: number;
}

export interface ReplayFixture {
  readonly fixtureVersion: 1;
  readonly initialSnapshot: GameSnapshot;
  readonly actions: ReadonlyArray<OrderedActionInput>;
  readonly luaExpectations: ReadonlyArray<LuaExpectation>;
  readonly expectedFinalStateHash: string;
  readonly expectedRejectionCount: number;
}

export interface ScriptAction {
  readonly type: string;
  readonly payload: LuaValue;
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

export function createFirstDealInitialState(): CanonicalGameState {
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
    releaseId: "builtin_first_deal_1",
    rng: FIRST_DEAL_RNG,
    settings: runtime.settings,
    players: {
      alice: { id: "alice", name: "Alice" },
      bob: { id: "bob", name: "Bob" },
      carol: { id: "carol", name: "Carol" },
    },
    seats: {
      seat_1: { id: "seat_1", playerId: "alice", handId: "hand_seat_1" },
      seat_2: { id: "seat_2", playerId: "bob", handId: "hand_seat_2" },
      seat_3: { id: "seat_3", playerId: "carol", handId: "hand_seat_3" },
    },
    entities,
    scriptState: { phase: "setup" },
  });
}

export function createDiceDashInitialState(): CanonicalGameState {
  return createDiceDashState("builtin_dice_dash_1");
}

export function createDiceDashV2InitialState(): CanonicalGameState {
  return createDiceDashState("builtin_dice_dash_2");
}

function createDiceDashState(releaseId: string): CanonicalGameState {
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
    players: {
      alice: { id: "alice", name: "Alice" },
      bob: { id: "bob", name: "Bob" },
    },
    seats: {
      seat_1: { id: "seat_1", playerId: "alice", scoreId: "score_seat_1" },
      seat_2: { id: "seat_2", playerId: "bob", scoreId: "score_seat_2" },
    },
    entities,
    scriptState: { gameOver: false },
  });
}

function isRecord(value: unknown): value is Record<string, LuaValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scriptActions(value: LuaValue): ScriptAction[] {
  if (!Array.isArray(value)) throw new TypeError("Lua callback must return an action array");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.type !== "string" || !("payload" in item)) {
      throw new TypeError("Lua callback returned an invalid action descriptor");
    }
    return { type: item.type, payload: item.payload };
  });
}

export class DemoLuaHost {
  private constructor(
    readonly releaseId: string,
    private readonly lua: Sandbox,
    private readonly source: string,
  ) {}

  static async create(releaseId: string): Promise<DemoLuaHost> {
    return new DemoLuaHost(
      releaseId,
      await createSandbox({ instructionBudget: 50_000, memoryBudgetBytes: 512 * 1024 }),
      releaseFile(releaseId, "scripts/game.lua"),
    );
  }

  async callback(
    expectation: LuaExpectation,
    state: CanonicalGameState,
  ): Promise<ScriptAction[]> {
    if (this.releaseId === "builtin_first_deal_1") {
      const seatedPlayers = Object.keys(state.seats)
        .sort()
        .map((seatId) => {
          const seat = state.seats[seatId]!;
          return { handId: seat.handId as string, playerId: seat.playerId as string };
        });
      return scriptActions(await this.lua.run(this.source, {
        callback: expectation.callback,
        cards_per_player: state.settings.cardsPerPlayer,
        deck_id: "deck",
        seated_players: seatedPlayers,
      }));
    }

    const seatNumber = expectation.seatNumber;
    if (seatNumber === undefined) throw new TypeError("Dice callback needs seatNumber");
    const rollCounter = this.releaseId === "builtin_dice_dash_1"
      ? (() => {
          const rollSource = state.entities.roll_source?.components.container;
          if (rollSource === undefined) throw new TypeError("Missing roll source container");
          const topToken = rollSource.items[rollSource.items.length - 1];
          if (topToken === undefined) throw new TypeError("Roll source is empty");
          return state.entities[topToken]?.components.counter;
        })()
      : undefined;
    const die = state.entities.die?.components.die;
    const scoreId = `score_seat_${seatNumber}`;
    const score = state.entities[scoreId]?.components.counter;
    const winner = state.entities.winner?.components.counter;
    if (
      (this.releaseId === "builtin_dice_dash_1" && rollCounter === undefined) ||
      (this.releaseId === "builtin_dice_dash_2" && die === undefined) ||
      score === undefined ||
      winner === undefined
    ) {
      throw new TypeError("Dice callback state is incomplete");
    }
    return scriptActions(await this.lua.run(this.source, {
      callback: expectation.callback,
      current_score: score.value,
      die_id: "die",
      roll_value: this.releaseId === "builtin_dice_dash_1" ? rollCounter!.value : die!.value,
      score_id: scoreId,
      seat_number: seatNumber,
      target_score: state.settings.targetScore,
      winner: winner.value,
      winner_id: "winner",
    }));
  }

  close(): void {
    this.lua.close();
  }
}
