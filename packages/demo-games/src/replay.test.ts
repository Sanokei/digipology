import { describe, expect, test } from "bun:test";
import {
  applyOrdered,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type OrderedActionInput,
} from "digipology-kernel";
import firstDealJson from "../fixtures/first-deal-replay-v1.json";
import diceDashJson from "../fixtures/dice-dash-replay-v1.json";
import {
  DemoLuaHost,
  createDiceDashInitialState,
  createFirstDealInitialState,
  type ReplayFixture,
} from "./test-support";

const firstDeal = firstDealJson as unknown as ReplayFixture;
const diceDash = diceDashJson as unknown as ReplayFixture;

interface RunResult {
  readonly state: CanonicalGameState;
  readonly rejectionCount: number;
}

async function runRange(
  fixture: ReplayFixture,
  start: CanonicalGameState,
  fromIndex: number,
  toIndex: number,
): Promise<RunResult> {
  let state = start;
  let rejectionCount = 0;
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
      if (result.rejection !== undefined) rejectionCount += 1;
    }
  } finally {
    host.close();
  }
  return { state, rejectionCount };
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
  for (const fixture of [firstDeal, diceDash]) {
    test(`${fixture.initialSnapshot.releaseId} replays twice to its pinned hash`, async () => {
      expect(fixture.actions.length).toBeGreaterThanOrEqual(40);
      const first = await replay(fixture);
      const second = await replay(fixture);
      expect(first.rejectionCount).toBe(fixture.expectedRejectionCount);
      expect(second.rejectionCount).toBe(fixture.expectedRejectionCount);
      expect(snapshot(first.state).stateHash).toBe(fixture.expectedFinalStateHash);
      expect(snapshot(second.state).stateHash).toBe(fixture.expectedFinalStateHash);
      expect(first.state).toEqual(second.state);
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
});
