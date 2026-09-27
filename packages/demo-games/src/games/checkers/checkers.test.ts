import { describe, expect, test } from "bun:test";
import {
  applyOrdered,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type OrderedActionInput,
  type TransformComponent,
} from "digipology-kernel";
import { materializeBuiltinRelease } from "../../authoring";
import { buildCheckersRelease } from "./build";
import generatedRelease from "./release-1.generated";

function dropTransform(state: CanonicalGameState, squareId: string): TransformComponent {
  const square = state.entities[squareId]?.components.transform;
  if (square === undefined) throw new Error(`Missing square ${squareId}`);
  return {
    position: { ...square.position, y: 0.3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 0.76, y: 0.24, z: 0.76 },
  };
}

function replay(): CanonicalGameState {
  let state = loadSnapshot(generatedRelease.initialSnapshot);
  const action = (actor: OrderedActionInput["actor"], type: string, payload: unknown): void => {
    const result = applyOrdered(state, {
      sequence: state.sequence + 1,
      actionId: `checkers_${state.sequence + 1}`,
      actor,
      action: { type, payload },
    });
    expect(result.rejection).toBeUndefined();
    state = result.state;
  };
  action({ type: "system" }, "system.game_start", { settings: { sandbox: true } });
  action({ type: "system" }, "system.player_joined", { playerId: "alice", name: "Alice" });
  action({ type: "system" }, "system.seat_assign", { playerId: "alice", seatId: "seat_1" });
  action({ type: "player", playerId: "alice" }, "entity.grab", { entityId: "checker_seat_2_01" });
  action({ type: "player", playerId: "alice" }, "entity.drop", {
    entityId: "checker_seat_2_01",
    transform: dropTransform(state, "square_4_1"),
  });
  action({ type: "player", playerId: "alice" }, "entity.grab", { entityId: "checker_seat_1_01" });
  action({ type: "player", playerId: "alice" }, "entity.drop", {
    entityId: "checker_seat_1_01",
    transform: dropTransform(state, "square_0_1"),
  });
  action({ type: "player", playerId: "alice" }, "entity.flip", { entityId: "checker_seat_1_01" });
  return state;
}

describe("Tabletop Classics — Checkers", () => {
  test("matches the immutable generated release", () => {
    expect(materializeBuiltinRelease(buildCheckersRelease())).toEqual(generatedRelease);
  });

  test("loads the authored board through the real kernel", () => {
    const state = loadSnapshot(generatedRelease.initialSnapshot);
    expect(Object.values(state.entities).filter((entity) => entity.components["snap-point"] !== undefined)).toHaveLength(64);
    expect(Object.values(state.entities).filter((entity) => entity.components.tags?.values.includes("man") === true)).toHaveLength(24);
    expect(state.seats).toEqual({
      seat_1: { id: "seat_1", playerId: null },
      seat_2: { id: "seat_2", playerId: null },
    });
  });

  test("replays a move and crowning sequence to a fixed state hash", () => {
    const first = replay();
    const second = replay();
    expect(first).toEqual(second);
    expect(first.entities.checker_seat_1_01?.components.flippable?.flipped).toBe(true);
    expect(first.entities.square_0_1?.components["snap-point"]?.attached).toEqual(["checker_seat_1_01"]);
    expect(snapshot(first).stateHash).toBe("sha256:61f21442401da2a7241835e71661a5488a03005bc3514789b7159fe85d3f2937");
  });
});
