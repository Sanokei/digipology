import { describe, expect, test } from "bun:test";
import { createRng } from "digipology-prng";

import { applyOrdered, createInitialState, snapshot, type CanonicalGameState, type OrderedActionInput } from "./index";

const TRANSFORM = {
  position: { x: 0, y: 0.08, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
};

function initial(): CanonicalGameState {
  return createInitialState({
    releaseId: "interaction-actions-v1", rng: createRng("interaction-actions").state(), settings: { sandbox: true },
    players: { alice: { id: "alice" }, bob: { id: "bob" } },
    seats: {
      seat_a: { id: "seat_a", playerId: "alice", handId: "hand_a" },
      seat_b: { id: "seat_b", playerId: "bob", handId: "hand_b" },
    },
    entities: {
      hand_a: { id: "hand_a", components: { hand: { owner: "seat_a", canonicalOrder: true }, container: { items: [], capacity: null, ordering: "canonical", visibility: "owner:seat_a" } } },
      hand_b: { id: "hand_b", components: { hand: { owner: "seat_b", canonicalOrder: true }, container: { items: [], capacity: null, ordering: "canonical", visibility: "owner:seat_b" } } },
      token_a: { id: "token_a", components: { transform: TRANSFORM, grabbable: { enabled: true, heldBy: null }, lockable: { locked: false }, flippable: { flipped: false } } },
      token_b: { id: "token_b", components: { transform: { ...TRANSFORM, position: { x: 2, y: .08, z: 1 } }, grabbable: { enabled: true, heldBy: null }, lockable: { locked: false }, flippable: { flipped: false } } },
    },
  });
}

function run(state: CanonicalGameState, sequence: number, actionId: string, type: string, payload: unknown, playerId = "alice") {
  return applyOrdered(state, {
    sequence, actionId, actor: { type: "player", playerId }, action: { type, payload },
  } as OrderedActionInput<unknown>);
}

describe("sandbox object library", () => {
  test("spawns a versioned standard deck with stable action-derived IDs", () => {
    const first = run(initial(), 1, "spawn-deck", "entity.spawn", { libraryId: "cards_standard_54", transform: TRANSFORM });
    const second = run(initial(), 1, "different-action-id", "entity.spawn", { libraryId: "cards_standard_54", transform: TRANSFORM });
    expect(first.rejection).toBeUndefined();
    expect(first.state).toEqual(second.state);
    expect(snapshot(first.state).stateHash).toBe(snapshot(second.state).stateHash);
    expect(first.state.entities["ent_1_0"]?.components.container?.items).toHaveLength(54);
    expect(Object.keys(first.state.entities).filter((id) => id.startsWith("ent_1_"))).toHaveLength(55);
  });

  test("rejects spawning outside sandbox while consuming only sequence", () => {
    const before = initial(); before.settings = {};
    const result = run(before, 1, "denied", "entity.spawn", { libraryId: "die_d6" });
    expect(result.rejection?.reason).toBe("Spawning is not allowed in this release");
    expect(result.state.sequence).toBe(1);
    expect(result.state.entities).toEqual(before.entities);
    const scripted = applyOrdered(before, {
      sequence: 1, actionId: "script-denied", actor: { type: "script", scriptId: "rules" },
      action: { type: "entity.spawn", payload: { libraryId: "die_d6" } },
    });
    expect(scripted.rejection?.reason).toBe("Spawning is not allowed in this release");
    expect(scripted.state.entities).toEqual(before.entities);
  });

  test("clones container trees with fresh deterministic IDs and deletes atomically", () => {
    let state = run(initial(), 1, "spawn", "entity.spawn", { libraryId: "tool_bag" }).state;
    state = run(state, 2, "clone", "entity.clone", { entityId: "ent_1_0" }).state;
    expect(state.entities.ent_2_0?.components.container?.items).toEqual([]);
    const deleted = run(state, 3, "delete", "group.delete", { entityIds: ["ent_2_0", "ent_1_0"] });
    expect(deleted.rejection).toBeUndefined();
    expect(deleted.state.entities.ent_2_0).toBeUndefined();
    expect(deleted.state.entities.ent_1_0).toBeUndefined();
  });
});

describe("deck handling", () => {
  function withDeck(): CanonicalGameState {
    return run(initial(), 1, "spawn", "entity.spawn", { libraryId: "cards_standard_54", transform: TRANSFORM }).state;
  }

  test("draws to the actor hand and deals round-robin in seat order", () => {
    let state = withDeck();
    state = run(state, 2, "draw", "deck.draw", { deckId: "ent_1_0", count: 2 }).state;
    expect(state.entities.hand_a?.components.container?.items).toEqual(["ent_1_54", "ent_1_53"]);
    const dealt = run(state, 3, "deal", "deck.deal", { deckId: "ent_1_0", count: 2 });
    expect(dealt.rejection).toBeUndefined();
    expect(dealt.state.entities.hand_a?.components.container?.items.slice(-2)).toEqual(["ent_1_52", "ent_1_50"]);
    expect(dealt.state.entities.hand_b?.components.container?.items).toEqual(["ent_1_51", "ent_1_49"]);

    const oneSeat = run(dealt.state, 4, "deal-bob", "deck.deal", { deckId: "ent_1_0", count: 2, seatId: "seat_b" });
    expect(oneSeat.rejection).toBeUndefined();
    expect(oneSeat.state.entities.hand_a?.components.container?.items).toHaveLength(4);
    expect(oneSeat.state.entities.hand_b?.components.container?.items.slice(-2)).toEqual(["ent_1_48", "ent_1_47"]);
  });

  test("take, cut, search-take, and insufficient deal are deterministic and atomic", () => {
    let state = withDeck();
    const cut = run(state, 2, "cut", "deck.cut", { deckId: "ent_1_0", index: 10 });
    state = cut.state;
    expect(cut.events.at(-1)?.data.index).toBe(10);
    const searchedId = state.entities.ent_1_0!.components.container!.items[7]!;
    const searched = run(state, 3, "search", "deck.search_take", { deckId: "ent_1_0", cardId: searchedId });
    expect(searched.events.map((event) => event.type)).toEqual(["deck.searching", "deck.search_taken"]);
    state = searched.state;
    const taken = run(state, 4, "take", "deck.take_top", { deckId: "ent_1_0" });
    expect(taken.events.at(-1)?.type).toBe("deck.taken");
    const before = taken.state;
    const rejected = run(before, 5, "too-many", "deck.deal", { deckId: "ent_1_0", count: 100 });
    expect(rejected.rejection).toBeDefined();
    expect({ ...rejected.state, sequence: before.sequence }).toEqual(before);
  });

  test("chooses an omitted cut index with canonical RNG deterministically", () => {
    const first = run(withDeck(), 2, "random-cut-a", "deck.cut", { deckId: "ent_1_0" });
    const second = run(withDeck(), 2, "random-cut-b", "deck.cut", { deckId: "ent_1_0" });
    expect(first.rejection).toBeUndefined();
    expect(first.state.entities.ent_1_0?.components.container?.items).toEqual(second.state.entities.ent_1_0?.components.container?.items);
    expect(first.state.rng).toEqual(second.state.rng);
    expect(first.state.rng.draws).toBeGreaterThan(0);
  });

  test("merges cards into a deterministic deck and decks without losing order", () => {
    let state = withDeck();
    state = run(state, 2, "take-a", "deck.take_top", { deckId: "ent_1_0" }).state;
    state = run(state, 3, "take-b", "deck.take_top", { deckId: "ent_1_0" }).state;
    const merged = run(state, 4, "merge", "stack.merge", { sourceId: "ent_1_53", targetId: "ent_1_54", at: "top" });
    expect(merged.rejection).toBeUndefined();
    expect(merged.state.entities.ent_4_0?.components.container?.items).toEqual(["ent_1_54", "ent_1_53"]);
  });

  test("merges one complete deck into another atomically", () => {
    let state = withDeck();
    state = run(state, 2, "second-deck", "entity.spawn", { libraryId: "cards_standard_54", transform: {
      ...TRANSFORM, position: { x: 2, y: .08, z: 0 },
    } }).state;
    const merged = run(state, 3, "merge-decks", "stack.merge", { sourceId: "ent_2_0", targetId: "ent_1_0", at: "bottom" });
    expect(merged.rejection).toBeUndefined();
    expect(merged.state.entities.ent_2_0).toBeUndefined();
    expect(merged.state.entities.ent_1_0?.components.container?.items).toHaveLength(108);
    expect(merged.state.entities.ent_1_0?.components.container?.items.slice(0, 2)).toEqual(["ent_2_1", "ent_2_2"]);
    expect(merged.state.entities.ent_1_0?.components.container?.capacity).toBeNull();
  });

  test("dropping one loose card on another automatically forms a deck", () => {
    let state = withDeck();
    state = run(state, 2, "take-a", "deck.take_top", { deckId: "ent_1_0" }).state;
    state = run(state, 3, "take-b", "deck.take_top", { deckId: "ent_1_0" }).state;
    state = run(state, 4, "grab-card", "entity.grab", { entityId: "ent_1_53" }).state;
    const dropped = run(state, 5, "drop-card", "entity.drop", { entityId: "ent_1_53", transform: state.entities.ent_1_54!.components.transform });
    expect(dropped.rejection).toBeUndefined();
    expect(dropped.state.entities["ent_5_0"]?.components.container?.items).toEqual(["ent_1_54", "ent_1_53"]);
    expect(dropped.events.map(({ type }) => type)).toContain("deck.merged");

    state = run(dropped.state, 6, "take-c", "deck.take_top", { deckId: "ent_1_0" }).state;
    state = run(state, 7, "grab-c", "entity.grab", { entityId: "ent_1_52" }).state;
    const below = run(state, 8, "drop-below", "entity.drop", { entityId: "ent_1_52", transform: {
      ...state.entities.ent_1_52!.components.transform!, position: { x: .7, y: .08, z: -.4 },
    } });
    expect(below.rejection).toBeUndefined();
    expect(below.state.entities["ent_5_0"]?.components.container?.items).toEqual(["ent_1_52", "ent_1_54", "ent_1_53"]);
    expect(below.events.find(({ type }) => type === "deck.merged")?.data.at).toBe("bottom");
  });

  test("drops objects into bags and takes top or random with canonical RNG", () => {
    let state = run(initial(), 1, "bag", "entity.spawn", { libraryId: "tool_bag", transform: TRANSFORM }).state;
    state = run(state, 2, "die", "entity.spawn", { libraryId: "die_d6", transform: { ...TRANSFORM, position: { x: 1, y: .08, z: 0 } } }).state;
    state = run(state, 3, "grab-die", "entity.grab", { entityId: "ent_2_0" }).state;
    const dropped = run(state, 4, "bag-die", "entity.drop", { entityId: "ent_2_0", transform: TRANSFORM });
    expect(dropped.rejection).toBeUndefined();
    expect(dropped.state.entities.ent_1_0?.components.container?.items).toEqual(["ent_2_0"]);
    const taken = run(dropped.state, 5, "take-random", "container.take", { containerId: "ent_1_0", mode: "random" });
    expect(taken.rejection).toBeUndefined();
    expect(taken.state.entities.ent_1_0?.components.container?.items).toEqual([]);
    expect(taken.events.at(-1)?.data).toMatchObject({ containerId: "ent_1_0", entityId: "ent_2_0", mode: "random" });
  });
});

describe("atomic group transforms", () => {
  test("moves, flips, and rotates a sorted selection atomically", () => {
    let state = run(initial(), 1, "move", "group.move", { entityIds: ["token_b", "token_a"], delta: { x: 3, y: 0, z: -2 } }).state;
    expect(state.entities.token_a?.components.transform?.position).toEqual({ x: 3, y: .08, z: -2 });
    state = run(state, 2, "flip", "group.flip", { entityIds: ["token_b", "token_a"] }).state;
    expect(state.entities.token_a?.components.flippable?.flipped).toBeTrue();
    state = run(state, 3, "rotate", "group.rotate", { entityIds: ["token_b", "token_a"], steps: 1 }).state;
    expect(state.entities.token_a?.components.transform?.rotation.y).not.toBe(0);
  });

  test("one locked member rejects the whole group without partial movement", () => {
    const state = initial();
    state.entities.token_b!.components.lockable!.locked = true;
    const result = run(state, 1, "blocked", "group.move", { entityIds: ["token_a", "token_b"], delta: { x: 1, y: 0, z: 0 } });
    expect(result.rejection?.reason).toContain("locked");
    expect(result.state.entities.token_a?.components.transform?.position).toEqual(TRANSFORM.position);
    expect(result.state.entities.token_b?.components.transform?.position).toEqual({ x: 2, y: .08, z: 1 });
  });
});
