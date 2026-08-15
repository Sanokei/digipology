import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/replay-card-deal-v1.json";
import scriptedZone from "../fixtures/scripted-zone-v1.json";
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

describe("scripted-zone-v1 golden contract", () => {
  function replay(loadAtMidpoint: boolean): {
    state: CanonicalGameState;
    events: KernelEvent[];
    rejections: number;
  } {
    let state = loadSnapshot(scriptedZone.initialSnapshot as GameSnapshot);
    const events: KernelEvent[] = [];
    let rejections = 0;
    const midpoint = Math.floor(scriptedZone.actions.length / 2);
    for (let index = 0; index < scriptedZone.actions.length; index += 1) {
      if (loadAtMidpoint && index === midpoint) state = loadSnapshot(snapshot(state));
      const ordered = scriptedZone.actions[index];
      if (ordered === undefined) throw new Error("Fixture action disappeared");
      const result = applyOrdered(state, ordered as OrderedActionInput);
      state = result.state;
      events.push(...result.events);
      if (result.rejection !== undefined) rejections += 1;
    }
    return { state, events, rejections };
  }

  test("double replay and midpoint snapshot reconstruction reach the pinned hash", () => {
    const first = replay(false);
    const second = replay(false);
    const reconstructed = replay(true);
    for (const result of [first, second, reconstructed]) {
      expect(snapshot(result.state).stateHash).toBe(
        scriptedZone.expectedFinalStateHash,
      );
      expect(result.rejections).toBe(1);
    }
    expect(first.state).toEqual(second.state);
    expect(first.state).toEqual(reconstructed.state);
  });

  test("pins the derived event sequence and snap tie-break", () => {
    const result = replay(false);
    expect(result.events.map((event) => event.type)).toEqual(
      scriptedZone.expectedEventTypes,
    );
    const tiedAttachment = result.events.find(
      (event) => event.actionId === "drop_tie" && event.type === "snap.attached",
    );
    expect(tiedAttachment?.data.snapPointId).toBe("snap_a");
  });
});
