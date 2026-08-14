import { describe, expect, test } from "bun:test";
import { hashValue } from "digipology-canonical-json";
import { createRng } from "digipology-prng";
import {
  ActionRegistry,
  SequenceError,
  applyOrdered,
  applyOrderedWithRegistry,
  canonicalizeTransform,
  cloneCanonical,
  createInitialState,
  destroyEntity,
  loadSnapshot,
  snapshot,
  spawnEntity,
  validateCanonicalGameState,
  type ActionDefinition,
  type CanonicalGameState,
  type EntityComponents,
  type OrderedActionInput,
  type TransformComponent,
} from "./index";

const identity: TransformComponent = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function entity(id: string, components: EntityComponents) {
  return { id, components };
}

function baseState(): CanonicalGameState {
  return createInitialState({
    releaseId: "release_test_1",
    rng: createRng("kernel-tests").state(),
    players: {
      alice: { id: "alice", name: "Alice" },
      bob: { id: "bob", name: "Bob" },
    },
    entities: {
      pawn: entity("pawn", {
        transform: identity,
        grabbable: { enabled: true, heldBy: null },
        flippable: { flipped: false },
      }),
      deck: entity("deck", {
        container: {
          items: ["card1", "card2", "card3"],
          capacity: 52,
          ordering: "ordered",
          visibility: "public",
        },
        deck: { enabled: true },
      }),
      target: entity("target", {
        container: {
          items: [],
          capacity: 4,
          ordering: "ordered",
          visibility: "public",
        },
      }),
      card1: entity("card1", { transform: identity, card: { definitionId: "c1", faceUp: false } }),
      card2: entity("card2", { transform: identity, card: { definitionId: "c2", faceUp: false } }),
      card3: entity("card3", { transform: identity, card: { definitionId: "c3", faceUp: false } }),
      score: entity("score", {
        counter: { value: 0, default: 0, min: 0, max: 10 },
      }),
    },
  });
}

function action(
  state: CanonicalGameState,
  actionId: string,
  type: string,
  payload: unknown,
  actor: OrderedActionInput["actor"] = { type: "player", playerId: "alice" },
): OrderedActionInput {
  return {
    sequence: state.sequence + 1,
    actionId,
    actor,
    action: { type, payload },
  };
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
}

describe("ordered transactions", () => {
  test("same snapshot and actions produce the same hash", () => {
    const initial = baseState();
    const stream = [
      { type: "deck.shuffle", payload: { deckId: "deck" } },
      { type: "deck.draw_to_container", payload: { deckId: "deck", target: "target", count: 2 } },
      { type: "counter.add", payload: { entityId: "score", amount: 7 } },
    ];
    const replay = () => {
      let state = cloneCanonical(initial);
      for (let index = 0; index < stream.length; index += 1) {
        const item = stream[index]!;
        state = applyOrdered(state, action(state, `same_${index}`, item.type, item.payload)).state;
      }
      return snapshot(state).stateHash;
    };
    expect(replay()).toBe(replay());
  });

  test("snapshot/load preserves and verifies the hash", () => {
    const saved = snapshot(baseState());
    expect(snapshot(loadSnapshot(saved)).stateHash).toBe(saved.stateHash);
    expect(saved).toMatchObject({
      formatVersion: 1,
      kernelVersion: 1,
      releaseId: "release_test_1",
      sequence: 0,
    });
    expect(saved.stateHash).toBe(hashValue(saved.state));
  });

  test("applyOrdered does not mutate frozen input", () => {
    const state = baseState();
    deepFreeze(state);
    const result = applyOrdered(
      state,
      action(state, "frozen", "counter.add", { entityId: "score", amount: 2 }),
    );
    expect(result.state.entities.score?.components.counter).toMatchObject({ value: 2 });
    expect(state.entities.score?.components.counter).toMatchObject({ value: 0 });
  });

  test("wrong sequence is a hard caller error", () => {
    const state = baseState();
    const ordered = action(state, "bad_seq", "entity.flip", { entityId: "pawn" });
    ordered.sequence = 9;
    expect(() => applyOrdered(state, ordered)).toThrow(SequenceError);
  });

  test("null action rejects without throwing and advances only sequence", () => {
    const state = baseState();
    const result = applyOrdered(state, {
      sequence: state.sequence + 1,
      actionId: "null_action",
      actor: { type: "player", playerId: "alice" },
      action: null as never,
    });
    const expected = cloneCanonical(state);
    expected.sequence = state.sequence + 1;

    expect(result.rejection).toBeDefined();
    expect(result.events[0]?.data.actionType).toBeNull();
    expect(result.state).toEqual(expected);
  });

  test("action without a payload key rejects without throwing", () => {
    const state = baseState();
    const result = applyOrdered(state, {
      sequence: state.sequence + 1,
      actionId: "missing_payload",
      actor: { type: "player", playerId: "alice" },
      action: { type: "counter.add" } as never,
    });

    expect(result.rejection?.reason).toBe("Action payload is required");
    expect(result.state.sequence).toBe(state.sequence + 1);
  });

  test("source validation is independent and rejection advances sequence", () => {
    const state = baseState();
    const result = applyOrdered(
      state,
      action(state, "wrong_source", "entity.grab", { entityId: "pawn" }, { type: "script" }),
    );
    expect(result.rejection?.reason).toContain("does not allow source");
    expect(result.state.sequence).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual(["action.rejected"]);
  });

  test("an apply mutation followed by throw is fully atomic", () => {
    const registry = new ActionRegistry();
    registry.register({
      type: "test.throw",
      version: 1,
      sources: ["system"],
      validate: () => ({ ok: true }),
      apply(draft) {
        (draft.entities.score!.components.counter as { value: number }).value = 9;
        throw new Error("boom");
      },
    });
    const state = baseState();
    const result = applyOrderedWithRegistry(
      state,
      action(state, "throw", "test.throw", {}, { type: "system" }),
      registry,
    );
    expect(result.rejection).toBeDefined();
    expect(result.state.entities.score?.components.counter).toMatchObject({ value: 0 });
    expect(hashValue({ ...result.state, sequence: 0 })).toBe(hashValue(state));
  });

  test("a misbehaving validator cannot mutate the input or committed draft", () => {
    const registry = new ActionRegistry();
    registry.register({
      type: "test.validator",
      version: 1,
      sources: ["system"],
      validate(state) {
        (state.entities.score!.components.counter as { value: number }).value = 8;
        return { ok: true };
      },
      apply: () => {},
    });
    const state = baseState();
    const result = applyOrderedWithRegistry(
      state,
      action(state, "validator", "test.validator", {}, { type: "system" }),
      registry,
    );
    expect(state.entities.score?.components.counter).toMatchObject({ value: 0 });
    expect(result.state.entities.score?.components.counter).toMatchObject({ value: 0 });
  });

  test("rollback replay converges with uninterrupted execution", () => {
    const initial = baseState();
    const stream = [
      { type: "counter.add", payload: { entityId: "score", amount: 2 } },
      { type: "entity.flip", payload: { entityId: "pawn" } },
      { type: "deck.shuffle", payload: { deckId: "deck" } },
      { type: "counter.add", payload: { entityId: "score", amount: 3 } },
    ];
    const runFrom = (start: CanonicalGameState, offset: number) => {
      let state = cloneCanonical(start);
      for (let index = offset; index < stream.length; index += 1) {
        const item = stream[index]!;
        state = applyOrdered(state, action(state, `rollback_${index}`, item.type, item.payload)).state;
      }
      return state;
    };
    const uninterrupted = runFrom(initial, 0);
    let checkpoint = cloneCanonical(initial);
    for (let index = 0; index < 2; index += 1) {
      const item = stream[index]!;
      checkpoint = applyOrdered(checkpoint, action(checkpoint, `rollback_${index}`, item.type, item.payload)).state;
    }
    const replayed = runFrom(loadSnapshot(snapshot(checkpoint)), 2);
    expect(snapshot(replayed).stateHash).toBe(snapshot(uninterrupted).stateHash);
  });

  test("duplicate registration throws", () => {
    const registry = new ActionRegistry();
    const definition: ActionDefinition = {
      type: "test.same",
      version: 1,
      sources: ["system"],
      validate: () => ({ ok: true }),
      apply: () => {},
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow("already registered");
  });
});

describe("tabletop invariants", () => {
  test("insufficient draw leaves gameplay hash unchanged except sequence", () => {
    const state = baseState();
    const result = applyOrdered(
      state,
      action(state, "too_many", "deck.draw_to_container", {
        deckId: "deck",
        target: "target",
        count: 4,
      }),
    );
    expect(result.rejection?.reason).toContain("insufficient");
    expect(hashValue({ ...result.state, sequence: state.sequence })).toBe(hashValue(state));
  });

  test("container exclusivity cannot be bypassed by a custom action", () => {
    const registry = new ActionRegistry();
    registry.register({
      type: "test.duplicate",
      version: 1,
      sources: ["system"],
      validate: () => ({ ok: true }),
      apply(draft) {
        const target = draft.entities.target!.components.container as { items: string[] };
        target.items.push("card1");
      },
    });
    const state = baseState();
    const result = applyOrderedWithRegistry(
      state,
      action(state, "duplicate", "test.duplicate", {}, { type: "system" }),
      registry,
    );
    expect(result.rejection).toBeDefined();
    expect((result.state.entities.target!.components.container as { items: string[] }).items).toEqual([]);
  });

  test("ordered conflicting grabs are stable and first actor wins", () => {
    function run(first: "alice" | "bob") {
      let state = baseState();
      const second = first === "alice" ? "bob" : "alice";
      state = applyOrdered(state, action(state, `grab_${first}`, "entity.grab", { entityId: "pawn" }, { type: "player", playerId: first })).state;
      const result = applyOrdered(state, action(state, `grab_${second}`, "entity.grab", { entityId: "pawn" }, { type: "player", playerId: second }));
      expect(result.rejection).toBeDefined();
      return result.state;
    }
    const aliceFirst = run("alice");
    const bobFirst = run("bob");
    expect((aliceFirst.entities.pawn!.components.grabbable as { heldBy: string }).heldBy).toBe("alice");
    expect((bobFirst.entities.pawn!.components.grabbable as { heldBy: string }).heldBy).toBe("bob");
    expect(snapshot(aliceFirst).stateHash).not.toBe(snapshot(bobFirst).stateHash);
    expect(snapshot(run("alice")).stateHash).toBe(snapshot(aliceFirst).stateHash);
  });

  test("invalid transforms reject and drop quantization is idempotent", () => {
    let state = baseState();
    state = applyOrdered(state, action(state, "grab", "entity.grab", { entityId: "pawn" })).state;
    const invalids = [
      { ...identity, position: { x: Number.NaN, y: 0, z: 0 } },
      { ...identity, rotation: { x: 0, y: 0, z: 0, w: 2 } },
      { ...identity, position: { x: 1_000_001, y: 0, z: 0 } },
    ];
    for (const transform of invalids) {
      const result = applyOrdered(state, action(state, `invalid_${state.sequence}`, "entity.drop", { entityId: "pawn", transform }));
      expect(result.rejection).toBeDefined();
      state = result.state;
    }
    const raw = {
      position: { x: 1.234567, y: -2.345678, z: 0 },
      rotation: { x: 0, y: 0, z: 0.00001, w: 0.99999999995 },
      scale: { x: 1.00001, y: 2.00004, z: 0.99999 },
    };
    const canonical = canonicalizeTransform(raw);
    expect(canonicalizeTransform(canonical)).toEqual(canonical);
    const dropped = applyOrdered(state, action(state, "valid_drop", "entity.drop", { entityId: "pawn", transform: raw }));
    expect(dropped.rejection).toBeUndefined();
    expect(dropped.state.entities.pawn?.components.transform).toEqual(canonical);
  });

  test("invalid canonical transform cannot enter state", () => {
    const state = baseState();
    (state.entities.pawn!.components.transform as TransformComponent).position.x = 0.00001;
    expect(() => validateCanonicalGameState(state)).toThrow("not canonicalized");
  });

  test("counter operations clamp at both bounds", () => {
    let state = baseState();
    state = applyOrdered(state, action(state, "high", "counter.add", { entityId: "score", amount: 99 })).state;
    expect(state.entities.score?.components.counter).toMatchObject({ value: 10 });
    state = applyOrdered(state, action(state, "low", "counter.set", { entityId: "score", value: -99 })).state;
    expect(state.entities.score?.components.counter).toMatchObject({ value: 0 });
  });
});

describe("RNG and deterministic IDs", () => {
  test("RNG replay is identical", () => {
    const first = applyOrdered(baseState(), action(baseState(), "shuffle", "deck.shuffle", { deckId: "deck" })).state;
    const secondBase = baseState();
    const second = applyOrdered(secondBase, action(secondBase, "shuffle", "deck.shuffle", { deckId: "deck" })).state;
    expect(first.rng).toEqual(second.rng);
    expect(first.entities.deck?.components.container).toEqual(second.entities.deck?.components.container);
  });

  test("spawn IDs replay identically and destroyed IDs are not reused", () => {
    const registry = new ActionRegistry();
    registry.register({
      type: "test.ids",
      version: 1,
      sources: ["system"],
      validate: () => ({ ok: true }),
      apply(draft, _action, ctx) {
        const first = spawnEntity(draft, { text: { value: "first" } }, () => ctx.allocateEntityId());
        destroyEntity(draft, first.id);
        const second = spawnEntity(draft, { text: { value: "second" } }, () => ctx.allocateEntityId());
        ctx.emit("test.ids", { first: first.id, second: second.id });
      },
    });
    function run() {
      const state = baseState();
      return applyOrderedWithRegistry(state, action(state, "spawn", "test.ids", {}, { type: "system" }), registry);
    }
    const first = run();
    const second = run();
    expect(first.events[0]?.data).toEqual({ first: "ent_spawn_0", second: "ent_spawn_1" });
    expect(first.state.entities.ent_spawn_0).toBeUndefined();
    expect(first.state.entities.ent_spawn_1).toBeDefined();
    expect(first.state).toEqual(second.state);
  });

  test("seeded property-style valid streams replay to identical hashes", () => {
    for (let seed = 0; seed < 16; seed += 1) {
      const choices = createRng(seed);
      const stream = Array.from({ length: 15 }, (_, index) => {
        const kind = choices.int(0, 2);
        if (kind === 0) return { type: "counter.add", payload: { entityId: "score", amount: choices.int(-4, 4) } };
        if (kind === 1) return { type: "counter.set", payload: { entityId: "score", value: choices.int(-5, 15) } };
        return { type: "entity.flip", payload: { entityId: "pawn" } };
      });
      const replay = () => {
        let state = baseState();
        for (let index = 0; index < stream.length; index += 1) {
          const item = stream[index]!;
          state = applyOrdered(state, action(state, `seed_${seed}_${index}`, item.type, item.payload)).state;
        }
        return snapshot(state).stateHash;
      };
      expect(replay()).toBe(replay());
    }
  });
});
