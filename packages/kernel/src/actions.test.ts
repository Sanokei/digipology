import { describe, expect, test } from "bun:test";
import { createRng } from "digipology-prng";
import {
  applyOrdered,
  cloneCanonical,
  componentRegistry,
  createInitialState,
  snapshot,
  type CanonicalGameState,
  type EntityComponents,
  type OrderedActionInput,
} from "./index";

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function entity(id: string, components: EntityComponents) {
  return { id, components };
}

function state(): CanonicalGameState {
  return createInitialState({
    releaseId: "release_actions_1",
    rng: createRng("die-roll-actions").state(),
    players: {
      alice: { id: "alice", name: "Alice" },
      bob: { id: "bob", name: "Bob" },
    },
    seats: {
      seat_1: { id: "seat_1", playerId: "alice", marker: "keep" },
    },
    entities: {
      die: entity("die", {
        die: { definitionId: "standard_d6", value: 1 },
        grabbable: { enabled: true, heldBy: null },
        transform: IDENTITY,
      }),
      custom_die: entity("custom_die", {
        die: { definitionId: "weather", value: "sun", faces: ["sun", "rain"] },
        transform: IDENTITY,
      }),
      pawn_a: entity("pawn_a", {
        grabbable: { enabled: true, heldBy: "alice" },
        transform: IDENTITY,
      }),
      pawn_b: entity("pawn_b", {
        grabbable: { enabled: true, heldBy: "alice" },
        transform: IDENTITY,
      }),
      plain: entity("plain", {}),
    },
  });
}

function ordered(
  current: CanonicalGameState,
  actionId: string,
  type: string,
  payload: unknown,
  actor: OrderedActionInput["actor"] = { type: "player", playerId: "bob" },
): OrderedActionInput {
  return {
    sequence: current.sequence + 1,
    actionId,
    actor,
    action: { type, payload },
  };
}

describe("die.roll", () => {
  test("validates entity, component, exact payload, and held-by-other conflicts", () => {
    const cases = [
      [{ entityId: "missing" }, "Unknown entity"],
      [{ entityId: "plain" }, "lacks die"],
      [{ entityId: "die", value: 6 }, "only a string entityId"],
    ] as const;
    let current = state();
    for (const [payload, reason] of cases) {
      const result = applyOrdered(
        current,
        ordered(current, `invalid_${current.sequence}`, "die.roll", payload),
      );
      expect(result.rejection?.reason).toContain(reason);
      current = result.state;
    }

    const held = cloneCanonical(current);
    held.entities.die!.components.grabbable!.heldBy = "alice";
    const conflict = applyOrdered(
      held,
      ordered(held, "held_by_other", "die.roll", { entityId: "die" }),
    );
    expect(conflict.rejection?.reason).toBe("Die is held by another player");

    // The holder may roll their own die; only a conflicting player/script is blocked.
    const holder = applyOrdered(
      held,
      ordered(
        held,
        "held_by_actor",
        "die.roll",
        { entityId: "die" },
        { type: "player", playerId: "alice" },
      ),
    );
    expect(holder.rejection).toBeUndefined();
    expect(holder.events[0]?.type).toBe("die.rolled");
  });

  test("uses explicit faces or the legacy standard_d6 fallback and advances RNG", () => {
    let current = state();
    const fallback = applyOrdered(
      current,
      ordered(current, "fallback", "die.roll", { entityId: "die" }),
    );
    expect(fallback.rejection).toBeUndefined();
    expect(fallback.events[0]?.data.value).toBe(5);
    expect(fallback.state.entities.die?.components.die?.value).toBe(5);
    expect(fallback.state.rng.draws).toBe(current.rng.draws + 1);

    current = fallback.state;
    const explicit = applyOrdered(
      current,
      ordered(
        current,
        "explicit",
        "die.roll",
        { entityId: "custom_die" },
        { type: "script", scriptId: "game" },
      ),
    );
    expect(explicit.rejection).toBeUndefined();
    expect(["sun", "rain"]).toContain(explicit.state.entities.custom_die?.components.die?.value);
  });

  test("same RNG state and ordered stream produce identical faces and hashes", () => {
    const replay = () => {
      let current = state();
      const values: Array<number | string> = [];
      for (let index = 0; index < 12; index += 1) {
        const result = applyOrdered(
          current,
          ordered(current, `roll_${index}`, "die.roll", { entityId: "die" }),
        );
        current = result.state;
        values.push(current.entities.die!.components.die!.value);
      }
      return { values, hash: snapshot(current).stateHash };
    };
    expect(replay()).toEqual(replay());
  });

  test("die is implemented without changing legacy serialized component shape", () => {
    expect(componentRegistry.die?.behavior).toBe("implemented");
    expect(state().entities.die?.components.die).toEqual({
      definitionId: "standard_d6",
      value: 1,
    });
  });
});

describe("entity.rotate", () => {
  test("applies deterministic 15 degree steps and replays to the same hash", () => {
    const run = () => {
      let current = state();
      for (let index = 0; index < 6; index += 1) {
        const result = applyOrdered(
          current,
          ordered(
            current,
            `rotate_${index}`,
            "entity.rotate",
            { entityId: "pawn_a", steps: 1 },
            { type: "player", playerId: "alice" },
          ),
        );
        expect(result.rejection).toBeUndefined();
        expect(result.events[0]).toMatchObject({
          type: "entity.rotated",
          data: { entityId: "pawn_a", steps: 1 },
        });
        current = result.state;
      }
      return current;
    };
    const rotated = run();
    expect(rotated.entities.pawn_a?.components.transform?.rotation.y).toBeCloseTo(Math.SQRT1_2, 3);
    expect(rotated.entities.pawn_a?.components.transform?.rotation.w).toBeCloseTo(Math.SQRT1_2, 3);
    expect(snapshot(rotated).stateHash).toBe(snapshot(run()).stateHash);
  });

  test("rejects malformed steps, missing transforms, locks, and other players' holds atomically", () => {
    const initial = state();
    initial.entities.pawn_a!.components.lockable = { locked: true };
    const cases: Array<[unknown, OrderedActionInput["actor"], string]> = [
      [{ entityId: "pawn_a", steps: 2 }, { type: "player", playerId: "alice" }, "steps"],
      [{ entityId: "plain", steps: 1 }, { type: "player", playerId: "alice" }, "lacks transform"],
      [{ entityId: "pawn_a", steps: 1 }, { type: "player", playerId: "alice" }, "locked"],
      [{ entityId: "pawn_b", steps: -1 }, { type: "player", playerId: "bob" }, "held by another"],
    ];
    let current = initial;
    for (const [payload, actor, reason] of cases) {
      const before = snapshot(current).stateHash;
      const result = applyOrdered(
        current,
        ordered(current, `reject_${current.sequence}`, "entity.rotate", payload, actor),
      );
      expect(result.rejection?.reason).toContain(reason);
      expect(snapshot({ ...result.state, sequence: current.sequence }).stateHash).toBe(before);
      current = result.state;
    }
  });
});

describe("player and seat lifecycle", () => {
  test("resume atomically replaces the saved roster at sequence one", () => {
    const initial = state();
    initial.scriptState = { scores: { alice: 3, bob: 4 }, creatorOwned: true };
    initial.prompts.choice = {
      id: "choice", kind: "confirm", playerId: "alice", title: "Continue?", status: "open",
    };
    initial.entities.hand = entity("hand", {
      hand: { owner: "alice", canonicalOrder: true },
      container: { items: [], capacity: null, ordering: "ordered", visibility: "owner:alice" },
    });
    const payload = {
      roster: [
        { playerId: "new_host", name: "Host", seatId: "seat_1", previousPlayerId: "alice" },
        { playerId: "new_guest", name: "Guest", seatId: "seat_2", previousPlayerId: "bob" },
      ],
    };
    const resume = () => applyOrdered(
      cloneCanonical(initial),
      ordered(initial, "resume", "system.game_resumed", payload, { type: "system" }),
    );
    const result = resume();
    expect(result.rejection).toBeUndefined();
    expect(result.state.players).toEqual({
      new_guest: { id: "new_guest", name: "Guest" },
      new_host: { id: "new_host", name: "Host" },
    });
    expect(result.state.seats.seat_1).toEqual({ id: "seat_1", marker: "keep", playerId: "new_host" });
    expect(result.state.seats.seat_2).toEqual({ id: "seat_2", playerId: "new_guest" });
    expect(result.state.entities.pawn_a?.components.grabbable?.heldBy).toBeNull();
    expect(result.state.entities.hand?.components.hand?.owner).toBe("new_host");
    expect(result.state.entities.hand?.components.container?.visibility).toBe("owner:new_host");
    expect(result.state.prompts.choice?.playerId).toBe("new_host");
    expect(result.events).toEqual([expect.objectContaining({
      type: "game.resumed",
      data: { roster: payload.roster, removedPlayerIds: ["alice", "bob"] },
    })]);
    expect(result.state.scriptState).toEqual(initial.scriptState);
    expect(snapshot(result.state).stateHash).toBe(snapshot(resume().state).stateHash);
    // Insertion order in the saved roster and opaque state cannot affect StateHash.
    initial.scriptState = { creatorOwned: true, scores: { bob: 4, alice: 3 } };
    initial.players = Object.fromEntries(Object.entries(initial.players).reverse());
    initial.seats = Object.fromEntries(Object.entries(initial.seats).reverse());
    expect(snapshot(resume().state).stateHash).toBe(snapshot(result.state).stateHash);
  });

  test("resume rejects non-system, repeated, duplicate, and unknown mappings", () => {
    const initial = state();
    const valid = { roster: [{ playerId: "new", seatId: "seat_1", previousPlayerId: "alice" }] };
    expect(applyOrdered(initial, ordered(initial, "player_resume", "system.game_resumed", valid))
      .rejection?.reason).toContain("does not allow source player");
    expect(applyOrdered(initial, ordered(initial, "script_resume", "system.game_resumed", valid,
      { type: "script", scriptId: "rules" })).rejection?.reason).toContain("does not allow source script");
    const started = applyOrdered(initial, ordered(initial, "started", "system.game_start", {}, { type: "system" })).state;
    expect(applyOrdered(started, ordered(started, "late_resume", "system.game_resumed", valid, { type: "system" }))
      .rejection?.reason).toContain("sequence zero");
    for (const [payload, reason] of [
      [{ roster: [] }, "non-empty roster"],
      [{ roster: [{ playerId: "one", seatId: "s1", previousPlayerId: "alice" }, { playerId: "two", seatId: "s2", previousPlayerId: "alice" }] }, "Duplicate previous player"],
      [{ roster: [{ playerId: "new", seatId: "seat_1", previousPlayerId: "missing" }] }, "Unknown previous player"],
      [{ roster: [{ playerId: "new", seatId: "seat_1" }, { playerId: "new", seatId: "seat_2" }] }, "Duplicate resumed player"],
      [{ roster: [{ playerId: "one", seatId: "seat_1" }, { playerId: "two", seatId: "seat_1" }] }, "Duplicate resumed seat"],
    ] as const) {
      expect(applyOrdered(initial, ordered(initial, "bad_resume", "system.game_resumed", payload, { type: "system" }))
        .rejection?.reason).toContain(reason);
    }
  });

  test("join and seat assignment add canonical records and emit derived events", () => {
    let current = state();
    const joined = applyOrdered(
      current,
      ordered(
        current,
        "join_carol",
        "system.player_joined",
        { playerId: "carol", name: "Carol" },
        { type: "system" },
      ),
    );
    expect(joined.state.players.carol).toEqual({ id: "carol", name: "Carol" });
    expect(joined.events.map((event) => event.type)).toEqual(["player.joined"]);

    current = joined.state;
    const seated = applyOrdered(
      current,
      ordered(
        current,
        "seat_carol",
        "system.seat_assign",
        { playerId: "carol", seatId: "seat_3" },
        { type: "system" },
      ),
    );
    expect(seated.state.seats.seat_3).toEqual({ id: "seat_3", playerId: "carol" });
    expect(seated.events[0]?.type).toBe("seat.assigned");
  });

  test("players change seats or spectate without displacing another player", () => {
    const initial = state();
    initial.seats.seat_2 = { id: "seat_2", playerId: "bob" };
    initial.seats.seat_3 = { id: "seat_3", playerId: null };
    const moved = applyOrdered(initial, ordered(
      initial,
      "move_alice",
      "seat.change",
      { seatId: "seat_3" },
      { type: "player", playerId: "alice" },
    ));
    expect(moved.rejection).toBeUndefined();
    expect(moved.state.seats.seat_1?.playerId).toBeNull();
    expect(moved.state.seats.seat_3?.playerId).toBe("alice");
    expect(moved.events.map((event) => event.type)).toEqual(["seat.left", "seat.assigned"]);

    const occupied = applyOrdered(moved.state, ordered(
      moved.state,
      "take_bob",
      "seat.change",
      { seatId: "seat_2" },
      { type: "player", playerId: "alice" },
    ));
    expect(occupied.rejection?.reason).toContain("occupied");
    expect(occupied.state.seats.seat_3?.playerId).toBe("alice");

    const spectating = applyOrdered(occupied.state, ordered(
      occupied.state,
      "spectate",
      "seat.change",
      { seatId: null },
      { type: "player", playerId: "alice" },
    ));
    expect(spectating.rejection).toBeUndefined();
    expect(spectating.state.seats.seat_3?.playerId).toBeNull();
    expect(spectating.events.map((event) => event.type)).toEqual(["seat.left"]);
  });

  test("voluntary departure releases held entities, clears seats, then removes player", () => {
    const result = applyOrdered(
      state(),
      ordered(
        state(),
        "alice_left",
        "system.player_left",
        { playerId: "alice" },
        { type: "system" },
      ),
    );
    expect(result.rejection).toBeUndefined();
    expect(result.state.players.alice).toBeUndefined();
    expect(result.state.seats.seat_1).toEqual({
      id: "seat_1",
      marker: "keep",
      playerId: null,
    });
    expect(result.state.entities.pawn_a?.components.grabbable?.heldBy).toBeNull();
    expect(result.state.entities.pawn_b?.components.grabbable?.heldBy).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual([
      "entity.dropped",
      "entity.dropped",
      "seat.left",
      "player.left",
    ]);
    expect(result.events.slice(0, 2).map((event) => event.data)).toEqual([
      { entityId: "pawn_a", playerId: "alice", reason: "player_left" },
      { entityId: "pawn_b", playerId: "alice", reason: "player_left" },
    ]);
  });

  test("system lifecycle actions reject player actors and invalid records", () => {
    for (const [type, payload] of [
      ["system.player_joined", { playerId: "carol" }],
      ["system.player_left", { playerId: "alice" }],
      ["system.seat_assign", { playerId: "alice", seatId: "seat_2" }],
    ] as const) {
      const current = state();
      const result = applyOrdered(current, ordered(current, type, type, payload));
      expect(result.rejection?.reason).toContain("does not allow source player");
    }

    const current = state();
    const unknownSeatPlayer = applyOrdered(
      current,
      ordered(
        current,
        "unknown_seat_player",
        "system.seat_assign",
        { playerId: "missing", seatId: "seat_2" },
        { type: "system" },
      ),
    );
    expect(unknownSeatPlayer.rejection?.reason).toContain("Unknown player");
  });
});
