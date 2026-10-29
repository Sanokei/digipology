import { expect, test } from "bun:test";
import { createInitialState, seedInitialRoster, snapshot } from "./index";

test("new-session roster preserves authored state, hand metadata and canonical order without mutating its source", () => {
  const source = createInitialState({ releaseId: "session_fixture", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    players: { old: { id: "old", name: "Old" } }, seats: { seat_1: { id: "seat_1", playerId: "old", handId: "hand" } },
    entities: { hand: { id: "hand", components: { hand: { owner: "old", canonicalOrder: true }, container: { items: [], ordering: "canonical", visibility: "owner:old", capacity: 8 } } } },
  });
  const before = snapshot(source);
  const roster = [{ playerId: "alice", name: "Alice", seatId: "seat_1" }, { playerId: "bob", name: "Bob", seatId: "seat_2" }];
  const first = seedInitialRoster(source, roster);
  expect(first.players).toEqual({ alice: { id: "alice", name: "Alice" }, bob: { id: "bob", name: "Bob" } });
  expect(first.seats.seat_1?.handId).toBe("hand");
  expect(first.entities.hand?.components.hand?.owner).toBe("alice");
  expect(first.entities.hand?.components.container?.visibility).toBe("owner:alice");
  expect(snapshot(first)).toEqual(snapshot(seedInitialRoster(source, [...roster].reverse())));
  expect(snapshot(source)).toEqual(before);
  expect(first.sequence).toBe(0);
});

test("roster seeding rejects collisions and cannot rewrite a running game's membership", () => {
  const source = createInitialState({ releaseId: "session_fixture", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 } });
  const player = { playerId: "alice", name: "Alice", seatId: "seat_1" };
  expect(() => seedInitialRoster(source, [player, player])).toThrow("distinct");
  expect(() => seedInitialRoster({ ...source, sequence: 1 }, [player])).toThrow("sequence zero");
  const special = seedInitialRoster(source, [{ playerId: "__proto__", name: "A player", seatId: "constructor" }]);
  expect(Object.hasOwn(special.players, "__proto__")).toBe(true);
  expect(special.seats.constructor?.playerId).toBe("__proto__");
  expect(Object.getPrototypeOf(special.players)).toBe(Object.prototype);
  expect(() => seedInitialRoster(source, [{ ...player, name: undefined } as never])).toThrow("distinct");
  const golden = createInitialState({ releaseId: "session_roster_golden", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 } });
  expect(snapshot(seedInitialRoster(golden, [player, { playerId: "bob", name: "Bob", seatId: "seat_2" }])).stateHash)
    .toBe("sha256:f42b25cf9270411f5b194acb777e8376e85d5a68b482b4076132484bdbdcb5a0");
});
