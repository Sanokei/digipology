import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/replay-card-deal-v1.json";
import {
  applyOrdered,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type KernelEvent,
  type OrderedActionInput,
} from "./index";

describe("replay-card-deal-v1 golden contract", () => {
  function replay(): { state: CanonicalGameState; events: KernelEvent[] } {
    let state = loadSnapshot(fixture.initialSnapshot as GameSnapshot);
    const events: KernelEvent[] = [];
    for (const ordered of fixture.actions) {
      const result = applyOrdered(state, ordered as OrderedActionInput);
      state = result.state;
      events.push(...result.events);
    }
    return { state, events };
  }

  test("replays 52 cards and 44 actions to the committed hash", () => {
    expect(Object.keys(fixture.initialSnapshot.state.entities)).toHaveLength(56);
    expect(fixture.actions).toHaveLength(44);
    const first = replay();
    const second = replay();
    expect(snapshot(first.state).stateHash).toBe(fixture.expectedFinalStateHash);
    expect(snapshot(second.state).stateHash).toBe(fixture.expectedFinalStateHash);
    expect(first.state).toEqual(second.state);
  });

  test("emits the committed renderer event sequence", () => {
    expect(replay().events.map((event) => event.type)).toEqual(
      fixture.expectedEventTypes,
    );
  });
});
