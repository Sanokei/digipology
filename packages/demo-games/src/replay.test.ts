import { describe, expect, test } from "bun:test";
import {
  applyOrdered,
  applyOrderedWithScripts,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type OrderedActionInput,
} from "digipology-kernel";
import firstDealJson from "../fixtures/first-deal-replay-v1.json";
import diceDashJson from "../fixtures/dice-dash-replay-v1.json";
import diceDashV2Json from "../fixtures/dice-dash-replay-v2.json";
import zoneRunnerJson from "../fixtures/zone-runner-replay-v1.json";
import {
  DemoLuaHost,
  createBuiltinCreatorRuntime,
  createDiceDashInitialState,
  createDiceDashV2InitialState,
  createFirstDealInitialState,
  createZoneRunnerInitialState,
  type ReplayFixture,
} from "./test-support";

const firstDeal = firstDealJson as unknown as ReplayFixture;
const diceDash = diceDashJson as unknown as ReplayFixture;
const diceDashV2 = diceDashV2Json as unknown as ReplayFixture;
const zoneRunner = zoneRunnerJson as unknown as ReplayFixture;

interface RunResult {
  readonly state: CanonicalGameState;
  readonly rejectionCount: number;
  readonly eventTypes: readonly string[];
}

async function runRange(
  fixture: ReplayFixture,
  start: CanonicalGameState,
  fromIndex: number,
  toIndex: number,
): Promise<RunResult> {
  let state = start;
  let rejectionCount = 0;
  const eventTypes: string[] = [];
  if (fixture.initialSnapshot.releaseId === "builtin_zone_runner_1") {
    const runtime = await createBuiltinCreatorRuntime(fixture.initialSnapshot.releaseId);
    try {
      for (let index = fromIndex; index < toIndex; index += 1) {
        const ordered = fixture.actions[index]!;
        const result = await applyOrderedWithScripts(state, ordered as OrderedActionInput, { runtime });
        state = result.state;
        eventTypes.push(...result.events.map((event) => event.type));
        if (result.rejection !== undefined) rejectionCount += 1;
      }
    } finally {
      runtime.close();
    }
    return { state, rejectionCount, eventTypes };
  }
  const host = await DemoLuaHost.create(fixture.initialSnapshot.releaseId);
  try {
    for (let index = fromIndex; index < toIndex; index += 1) {
      const ordered = fixture.actions[index]!;
      const expectation = fixture.luaExpectations.find(
        (candidate) => candidate.beforeSequence === ordered.sequence,
      );
      if (expectation !== undefined) {
        const generated = await host.callback(expectation, state);
        const expected = expectation.actionSequences.map((sequence) => {
          const action = fixture.actions[sequence - 1];
          if (action === undefined || action.sequence !== sequence) {
            throw new Error(`Missing fixture action ${sequence}`);
          }
          expect(action.actor.type).toBe("script");
          return action.action;
        });
        expect(generated).toEqual(expected);
      }
      const result = applyOrdered(state, ordered as OrderedActionInput);
      state = result.state;
      eventTypes.push(...result.events.map((event) => event.type));
      if (result.rejection !== undefined) rejectionCount += 1;
    }
  } finally {
    host.close();
  }
  return { state, rejectionCount, eventTypes };
}

async function replay(fixture: ReplayFixture): Promise<RunResult> {
  return runRange(
    fixture,
    loadSnapshot(fixture.initialSnapshot as GameSnapshot),
    0,
    fixture.actions.length,
  );
}

function counterValue(state: CanonicalGameState, entityId: string): number {
  const counter = state.entities[entityId]?.components.counter;
  if (counter === undefined) throw new Error(`Missing counter ${entityId}`);
  return counter.value;
}

describe("committed golden replays", () => {
  for (const fixture of [firstDeal, diceDash, diceDashV2, zoneRunner]) {
    test(`${fixture.initialSnapshot.releaseId} replays twice to its pinned hash`, async () => {
      if (["builtin_first_deal_1", "builtin_dice_dash_1"].includes(fixture.initialSnapshot.releaseId)) {
        expect(fixture.actions.length).toBeGreaterThanOrEqual(40);
      } else {
        expect(fixture.actions.length).toBeGreaterThan(0);
      }
      const first = await replay(fixture);
      const second = await replay(fixture);
      expect(first.rejectionCount).toBe(fixture.expectedRejectionCount);
      expect(second.rejectionCount).toBe(fixture.expectedRejectionCount);
      expect(snapshot(first.state).stateHash).toBe(fixture.expectedFinalStateHash);
      expect(snapshot(second.state).stateHash).toBe(fixture.expectedFinalStateHash);
      expect(first.state).toEqual(second.state);
      if (fixture.expectedEventTypes !== undefined) {
        expect(first.eventTypes).toEqual(fixture.expectedEventTypes);
      }
      if (fixture.expectedScriptState !== undefined) {
        expect(first.state.scriptState).toMatchObject(fixture.expectedScriptState);
      }
    });

    test(`${fixture.initialSnapshot.releaseId} reconstructs in a fresh VM at midpoint`, async () => {
      const split = Math.floor(fixture.actions.length / 2);
      const initial = loadSnapshot(fixture.initialSnapshot as GameSnapshot);
      const firstHalf = await runRange(fixture, initial, 0, split);
      const checkpoint = snapshot(firstHalf.state);
      const reconstructed = loadSnapshot(checkpoint);
      const secondHalf = await runRange(
        fixture,
        reconstructed,
        split,
        fixture.actions.length,
      );
      expect(snapshot(secondHalf.state).stateHash).toBe(fixture.expectedFinalStateHash);
    });
  }
});

describe("game contracts", () => {
  test("fixture snapshots match the release-derived initial states", () => {
    expect(snapshot(createFirstDealInitialState())).toEqual(firstDeal.initialSnapshot);
    expect(snapshot(createDiceDashInitialState())).toEqual(diceDash.initialSnapshot);
    expect(snapshot(createDiceDashV2InitialState())).toEqual(diceDashV2.initialSnapshot);
    expect(snapshot(createZoneRunnerInitialState())).toEqual(zoneRunner.initialSnapshot);
  });

  test("First Deal on_start deterministically deals five cards to every occupied seat", async () => {
    const afterStart = await runRange(
      firstDeal,
      loadSnapshot(firstDeal.initialSnapshot as GameSnapshot),
      0,
      5,
    );
    for (const seatId of ["seat_1", "seat_2", "seat_3"]) {
      const hand = afterStart.state.entities[`hand_${seatId}`]?.components.container;
      expect(hand?.items).toHaveLength(5);
    }
    const deck = afterStart.state.entities.deck?.components.container;
    expect(deck?.items).toHaveLength(52 - 5 * 3);

    const repeated = await runRange(
      firstDeal,
      loadSnapshot(firstDeal.initialSnapshot as GameSnapshot),
      0,
      5,
    );
    expect(snapshot(repeated.state).stateHash).toBe(snapshot(afterStart.state).stateHash);
  });

  test("Dice Dash reaches the same winner and scores on every seeded playthrough", async () => {
    const first = await replay(diceDash);
    const second = await replay(diceDash);
    const firstResult = {
      winner: counterValue(first.state, "winner"),
      scores: [
        counterValue(first.state, "score_seat_1"),
        counterValue(first.state, "score_seat_2"),
      ],
    };
    const secondResult = {
      winner: counterValue(second.state, "winner"),
      scores: [
        counterValue(second.state, "score_seat_1"),
        counterValue(second.state, "score_seat_2"),
      ],
    };
    expect(firstResult).toEqual({ winner: 1, scores: [20, 18] });
    expect(secondResult).toEqual(firstResult);
  });

  test("Dice Dash v2 rolls through Lua and covers canonical lifecycle actions", async () => {
    const result = await replay(diceDashV2);
    expect(result.rejectionCount).toBe(1);
    expect(result.state.entities.die?.components.die?.value).toBe(2);
    expect(counterValue(result.state, "score_seat_2")).toBe(3);
    expect(result.state.players.alice).toBeUndefined();
    expect(result.state.players.carol).toBeUndefined();
    expect(result.state.seats.seat_1?.playerId).toBeNull();
    expect(result.state.seats.seat_3?.playerId).toBeNull();
  });

  test("Zone Runner composes zones, snaps, prompts, timers, turns, and scores into a winner", async () => {
    const result = await replay(zoneRunner);
    expect(result.eventTypes).toEqual(expect.arrayContaining([
      "zone.entered",
      "snap.attached",
      "prompt.responded",
      "timer.fired",
    ]));
    expect(result.state.entities.slot_1?.components["snap-point"]?.attached).toEqual([
      "runner_seat_1_a",
    ]);
    expect(result.state.entities.slot_2?.components["snap-point"]?.attached).toEqual([
      "runner_seat_1_b",
    ]);
    expect(result.state.entities.score_seat_1?.components.counter?.value).toBe(2);
    expect(result.state.scriptState).toMatchObject({
      winner_id: "alice",
      opening_choice: "run",
      timeouts: 1,
    });
  }, 20_000);

  test("Zone Runner seats a guest who joins after the live room started into the rotation", async () => {
    // Live rooms sequence system.game_start when the host enters; later guests
    // arrive as system.player_joined + system.seat_assign (worker join path).
    const runtime = await createBuiltinCreatorRuntime("builtin_zone_runner_1");
    try {
      let state = loadSnapshot(zoneRunner.initialSnapshot as GameSnapshot);
      const started = await applyOrderedWithScripts(state, zoneRunner.actions[0]!, { runtime });
      state = started.state;
      const joined = await applyOrderedWithScripts(state, {
        sequence: 2,
        actionId: "zr-carol-joined",
        actor: { type: "system" },
        action: { type: "system.player_joined", payload: { playerId: "carol", name: "Carol" } },
      }, { runtime });
      expect(joined.rejection).toBeUndefined();
      const seated = await applyOrderedWithScripts(joined.state, {
        sequence: 3,
        actionId: "zr-carol-seated",
        actor: { type: "system" },
        action: { type: "system.seat_assign", payload: { playerId: "carol", seatId: "seat_3" } },
      }, { runtime });
      expect(seated.rejection).toBeUndefined();
      const stdlib = seated.state.scriptState.__stdlib as {
        turns: { active: boolean; order: string[]; index: number };
        scores: Record<string, number>;
      };
      expect(stdlib.turns.active).toBe(true);
      expect([...stdlib.turns.order].sort()).toEqual(["alice", "bob", "carol"]);
      expect(stdlib.turns.order[stdlib.turns.index - 1]).toBe("alice");
      expect(stdlib.scores.carol).toBe(0);
    } finally {
      runtime.close();
    }
  }, 20_000);
});
