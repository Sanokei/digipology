import { describe, expect, test } from "bun:test";
import { hashValue } from "digipology-canonical-json";
import { createRng } from "digipology-prng";
import {
  ActionRegistry,
  TEXT_MAX_UTF8_BYTES,
  applyOrdered,
  applyOrderedWithRegistry,
  builtInActions,
  canPlayerViewContainer,
  cloneCanonical,
  componentRegistry,
  createInitialState,
  destroyEntity,
  recomputeZoneMembership,
  snapshot,
  type CanonicalGameState,
  type EntityComponents,
  type KernelEvent,
  type OrderedActionInput,
  type TransformComponent,
} from "./index";

const IDENTITY: TransformComponent = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function transform(x: number, y = 0, z = 0, scale = 1): TransformComponent {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: scale, y: scale, z: scale },
  };
}

function entity(id: string, components: EntityComponents) {
  return { id, components };
}

function base(entities: CanonicalGameState["entities"], settings = {}) {
  return createInitialState({
    releaseId: "release_tabletop_test",
    rng: createRng("tabletop-actions").state(),
    settings,
    players: { alice: { id: "alice" }, bob: { id: "bob" } },
    seats: { seat_1: { id: "seat_1", playerId: "alice" } },
    entities,
  });
}

function ordered(
  state: CanonicalGameState,
  actionId: string,
  type: string,
  payload: unknown,
  actor: OrderedActionInput["actor"] = { type: "script", scriptId: "game" },
): OrderedActionInput {
  return {
    sequence: state.sequence + 1,
    actionId,
    actor,
    action: { type, payload },
  };
}

function gameplayHash(state: CanonicalGameState): string {
  const comparable = cloneCanonical(state);
  comparable.sequence = 0;
  return hashValue(comparable);
}

function apply(
  state: CanonicalGameState,
  actionId: string,
  type: string,
  payload: unknown,
  actor?: OrderedActionInput["actor"],
) {
  return applyOrdered(state, ordered(state, actionId, type, payload, actor));
}

describe("Appendix B registry and hand visibility", () => {
  test("registers every completed tabletop component and dependency", () => {
    for (const type of [
      "hand",
      "zone",
      "snap-point",
      "text",
      "button",
      "stackable",
      "lockable",
    ]) {
      expect(componentRegistry[type]?.behavior).toBe("implemented");
    }
    expect(componentRegistry.hand?.requires).toEqual(["container"]);
    expect(componentRegistry.zone?.requires).toEqual(["transform"]);
    expect(componentRegistry["snap-point"]?.requires).toEqual(["transform"]);
  });

  test("interprets owner player and owner seat visibility", () => {
    const state = base({
      public: entity("public", {
        container: { items: [], capacity: null, ordering: "ordered", visibility: "public" },
      }),
      seat_hand: entity("seat_hand", {
        container: { items: [], capacity: null, ordering: "ordered", visibility: "owner:seat_1" },
        hand: { owner: "seat_1", canonicalOrder: false },
      }),
      player_hand: entity("player_hand", {
        container: { items: [], capacity: null, ordering: "ordered", visibility: "owner:alice" },
        hand: { owner: "alice", canonicalOrder: true },
      }),
    });
    expect(canPlayerViewContainer(state, "public", "bob")).toBe(true);
    expect(canPlayerViewContainer(state, "seat_hand", "alice")).toBe(true);
    expect(canPlayerViewContainer(state, "seat_hand", "bob")).toBe(false);
    expect(canPlayerViewContainer(state, "player_hand", "alice")).toBe(true);
  });
});

describe("zone semantic membership", () => {
  function zoneState() {
    return base({
      zone_b: entity("zone_b", {
        transform: transform(0, 0, 0, 4),
        zone: { shape: "box", acceptedTags: ["red"], visibleInPlay: true },
      }),
      zone_a: entity("zone_a", {
        transform: transform(0, 0, 0, 4),
        zone: { shape: "sphere", acceptedTags: ["red"], visibleInPlay: false },
      }),
      piece_b: entity("piece_b", {
        transform: transform(5),
        tags: { values: ["red"] },
        grabbable: { enabled: true, heldBy: null },
      }),
      piece_a: entity("piece_a", {
        transform: transform(5),
        tags: { values: ["red"] },
        grabbable: { enabled: true, heldBy: null },
      }),
    });
  }

  test("drop enters and scripted movement leaves zones in zone-ID order", () => {
    let state = zoneState();
    state = apply(
      state,
      "grab_a",
      "entity.grab",
      { entityId: "piece_a" },
      { type: "player", playerId: "alice" },
    ).state;
    const dropped = apply(
      state,
      "drop_a",
      "entity.drop",
      { entityId: "piece_a", transform: transform(0.00004) },
      { type: "player", playerId: "alice" },
    );
    expect(dropped.events.map((event) => event.type)).toEqual([
      "zone.entered",
      "zone.entered",
      "entity.dropped",
    ]);
    expect(dropped.events.slice(0, 2).map((event) => event.data.zoneId)).toEqual([
      "zone_a",
      "zone_b",
    ]);
    expect(dropped.state.entities.zone_a?.components.zone?.members).toEqual(["piece_a"]);

    const moved = apply(
      dropped.state,
      "move_a",
      "entity.move",
      { entityId: "piece_a", transform: transform(5) },
      { type: "script", scriptId: "game" },
    );
    expect(moved.events.map((event) => event.type)).toEqual(["zone.left", "zone.left"]);
    expect(moved.events.map((event) => event.data.zoneId)).toEqual(["zone_a", "zone_b"]);
  });

  test("batch recomputation orders entity IDs within each zone", () => {
    const state = zoneState();
    state.entities.piece_a!.components.transform = transform(0);
    state.entities.piece_b!.components.transform = transform(0);
    const events: KernelEvent[] = [];
    recomputeZoneMembership(state, ["piece_b", "piece_a"], {
      emit(type, data = {}) {
        events.push({ type, sequence: 0, actionId: "test", data });
      },
    });
    expect(events.map((event) => [event.data.zoneId, event.data.entityId])).toEqual([
      ["zone_a", "piece_a"],
      ["zone_a", "piece_b"],
      ["zone_b", "piece_a"],
      ["zone_b", "piece_b"],
    ]);
  });

  test("destroy inside a zone emits leave while a transient transform alone does not recompute", () => {
    const state = zoneState();
    state.entities.piece_a!.components.transform = transform(0);
    recomputeZoneMembership(state, ["piece_a"], { emit() {} });
    state.entities.piece_a!.components.transform = transform(5);
    expect(state.entities.zone_a?.components.zone?.members).toEqual(["piece_a"]);

    const registry = new ActionRegistry();
    registry.register({
      type: "test.destroy",
      version: 1,
      sources: ["system"],
      validate: () => ({ ok: true }),
      apply(draft, _action, ctx) {
        destroyEntity(draft, "piece_a", ctx);
      },
    });
    const result = applyOrderedWithRegistry(
      state,
      ordered(state, "destroy", "test.destroy", {}, { type: "system" }),
      registry,
    );
    expect(result.events.map((event) => event.type)).toEqual(["zone.left", "zone.left"]);
    expect(result.events.map((event) => event.data.zoneId)).toEqual(["zone_a", "zone_b"]);
  });
});

describe("snap resolution and drop precedence", () => {
  function snapState() {
    return base({
      snap_b: entity("snap_b", {
        transform: transform(1),
        "snap-point": { radius: 2, capacity: 1, tags: ["red"], alignment: null },
      }),
      snap_a: entity("snap_a", {
        transform: transform(-1),
        "snap-point": { radius: 2, capacity: 1, tags: ["red"], alignment: null },
      }),
      piece: entity("piece", {
        transform: transform(4),
        grabbable: { enabled: true, heldBy: null },
        stackable: { enabled: true },
        tags: { values: ["red"] },
      }),
      stack_target: entity("stack_target", {
        transform: IDENTITY,
        stackable: { enabled: true },
      }),
      blue: entity("blue", {
        transform: transform(4),
        tags: { values: ["blue"] },
      }),
    });
  }

  test("filters then chooses nearest and stable snap-point ID on an exact tie", () => {
    let state = snapState();
    state = apply(
      state,
      "grab",
      "entity.grab",
      { entityId: "piece" },
      { type: "player", playerId: "alice" },
    ).state;
    const result = apply(
      state,
      "tie_drop",
      "entity.drop",
      { entityId: "piece", transform: IDENTITY },
      { type: "player", playerId: "alice" },
    );
    expect(result.state.entities.snap_a?.components["snap-point"]?.attached).toEqual([
      "piece",
    ]);
    expect(result.state.stacks).toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual([
      "snap.attached",
      "entity.dropped",
    ]);
  });

  test("enforces explicit snap capacity and tag compatibility", () => {
    let state = snapState();
    state = apply(state, "attach_piece", "snap.attach", {
      snapPointId: "snap_a",
      entityId: "piece",
    }).state;
    const before = gameplayHash(state);
    const full = apply(state, "full", "snap.attach", {
      snapPointId: "snap_a",
      entityId: "blue",
    });
    expect(full.rejection).toBeDefined();
    expect(gameplayHash(full.state)).toBe(before);

    const mismatch = apply(state, "mismatch", "snap.attach", {
      snapPointId: "snap_b",
      entityId: "blue",
    });
    expect(mismatch.rejection).toBeDefined();
  });

  test("snap wins over an exact-position stack target and radius filtering falls through", () => {
    let state = snapState();
    state = apply(
      state,
      "grab_near",
      "entity.grab",
      { entityId: "piece" },
      { type: "player", playerId: "alice" },
    ).state;
    const snapped = apply(
      state,
      "snap_first",
      "entity.drop",
      { entityId: "piece", transform: IDENTITY },
      { type: "player", playerId: "alice" },
    );
    expect(snapped.events[0]?.type).toBe("snap.attached");
    expect(snapped.state.stacks).toBeUndefined();

    const far = snapState();
    far.entities.snap_a!.components["snap-point"]!.radius = 0.25;
    far.entities.snap_b!.components["snap-point"]!.radius = 0.25;
    let current = apply(
      far,
      "grab_far",
      "entity.grab",
      { entityId: "piece" },
      { type: "player", playerId: "alice" },
    ).state;
    const stacked = apply(
      current,
      "stack_fallback",
      "entity.drop",
      { entityId: "piece", transform: IDENTITY },
      { type: "player", playerId: "alice" },
    );
    expect(stacked.events[0]?.type).toBe("stack.created");
    expect(Object.values(stacked.state.stacks ?? {})[0]?.items).toEqual([
      "stack_target",
      "piece",
    ]);
  });
});

describe("stack actions", () => {
  function stackState() {
    return base(Object.fromEntries(
      ["a", "b", "c", "d", "e"].map((id, index) => [
        id,
        entity(id, { transform: transform(index * 2), stackable: { enabled: true } }),
      ]),
    ));
  }

  test("create, add, remove-top, merge, and dissolve preserve canonical order", () => {
    let state = stackState();
    state = apply(state, "create_1", "stack.create", {
      stackId: "stack_1",
      items: ["a", "b"],
    }).state;
    state = apply(state, "add_e", "stack.add", {
      stackId: "stack_1",
      entityId: "e",
    }).state;
    expect(state.stacks?.stack_1?.items).toEqual(["a", "b", "e"]);

    const removed = apply(
      state,
      "remove_e",
      "stack.remove_top",
      { stackId: "stack_1" },
      { type: "player", playerId: "alice" },
    );
    expect(removed.events[0]?.data.removed).toBe("e");
    expect(removed.state.stacks?.stack_1?.items).toEqual(["a", "b"]);

    state = apply(removed.state, "create_2", "stack.create", {
      stackId: "stack_2",
      items: ["c", "d"],
    }).state;
    const merged = apply(state, "merge", "stack.merge", {
      targetStackId: "stack_1",
      sourceStackId: "stack_2",
    });
    expect(merged.state.stacks?.stack_1?.items).toEqual(["a", "b", "c", "d"]);
    expect(merged.state.stacks?.stack_2).toBeUndefined();
    expect(merged.events.map((event) => event.type)).toEqual([
      "stack.changed",
      "stack.dissolved",
    ]);

    const dissolved = apply(merged.state, "dissolve", "stack.dissolve", {
      stackId: "stack_1",
    });
    expect(dissolved.state.stacks?.stack_1).toBeUndefined();
    expect(dissolved.events[0]?.data.items).toEqual(["a", "b", "c", "d"]);
  });

  test("stack add rejects an entity already in a container without partial mutation", () => {
    const state = base({
      stack_a: entity("stack_a", { transform: transform(0), stackable: { enabled: true } }),
      stack_b: entity("stack_b", { transform: transform(1), stackable: { enabled: true } }),
      held: entity("held", { transform: transform(2), stackable: { enabled: true } }),
      hand: entity("hand", {
        container: { items: ["held"], capacity: 2, ordering: "ordered", visibility: "public" },
      }),
    });
    const created = apply(state, "create", "stack.create", {
      stackId: "stack",
      items: ["stack_a", "stack_b"],
    }).state;
    const before = gameplayHash(created);
    const rejected = apply(created, "exclusive", "stack.add", {
      stackId: "stack",
      entityId: "held",
    });
    expect(rejected.rejection).toBeDefined();
    expect(gameplayHash(rejected.state)).toBe(before);
  });
});

describe("container, button, text, and locking actions", () => {
  function utilityState() {
    return base({
      item: entity("item", {
        transform: IDENTITY,
        grabbable: { enabled: true, heldBy: null },
        lockable: { locked: false },
      }),
      source: entity("source", {
        container: { items: ["item"], capacity: 2, ordering: "ordered", visibility: "public" },
      }),
      target: entity("target", {
        container: { items: [], capacity: 1, ordering: "ordered", visibility: "public" },
      }),
      full_target: entity("full_target", {
        container: { items: ["blocker"], capacity: 1, ordering: "ordered", visibility: "public" },
      }),
      blocker: entity("blocker", {}),
      button: entity("button", { button: { enabled: true, label: "Go" } }),
      disabled: entity("disabled", { button: { enabled: false, label: "No" } }),
      text: entity("text", { text: { value: "old" } }),
    });
  }

  test("container.move transfers atomically and capacity failure is byte-identical", () => {
    const state = utilityState();
    const failed = apply(state, "full", "container.move", {
      entity: "item",
      from: "source",
      to: "full_target",
      index: 1,
    });
    expect(failed.rejection).toBeDefined();
    expect(gameplayHash(failed.state)).toBe(gameplayHash(state));

    const moved = apply(state, "move", "container.move", {
      entity: "item",
      from: "source",
      to: "target",
      index: 0,
    });
    expect(moved.events.map((event) => event.type)).toEqual(["container.moved"]);
    expect(moved.state.entities.source?.components.container?.items).toEqual([]);
    expect(moved.state.entities.target?.components.container?.items).toEqual(["item"]);
  });

  test("button validation invokes an injectable read-only can_press guard", () => {
    let calls = 0;
    const registry = new ActionRegistry({
      canPress(state, _action, entityId) {
        calls += 1;
        expect(state.entities[entityId]?.components.button).toBeDefined();
        return false;
      },
    });
    for (const definition of builtInActions) registry.register(definition);
    const state = utilityState();
    const denied = applyOrderedWithRegistry(
      state,
      ordered(
        state,
        "denied",
        "button.press",
        { entityId: "button" },
        { type: "player", playerId: "alice" },
      ),
      registry,
    );
    expect(calls).toBe(1);
    expect(denied.rejection?.reason).toContain("can_press");

    const disabled = apply(
      state,
      "disabled",
      "button.press",
      { entityId: "disabled" },
      { type: "player", playerId: "alice" },
    );
    expect(disabled.rejection?.reason).toContain("disabled");

    const pressed = apply(
      state,
      "pressed",
      "button.press",
      { entityId: "button" },
      { type: "player", playerId: "alice" },
    );
    expect(pressed.events[0]?.type).toBe("button.pressed");
  });

  test("text.set enforces the explicit 4096-byte UTF-8 limit", () => {
    expect(TEXT_MAX_UTF8_BYTES).toBe(4096);
    const state = utilityState();
    const exact = "😀".repeat(1024);
    const changed = apply(state, "exact", "text.set", { entityId: "text", value: exact });
    expect(changed.events[0]?.type).toBe("text.changed");
    const tooLong = apply(changed.state, "long", "text.set", {
      entityId: "text",
      value: `${exact}x`,
    });
    expect(tooLong.rejection?.reason).toContain("4096");
    expect(tooLong.state.entities.text?.components.text?.value).toBe(exact);
  });

  test("script locking blocks ordinary grab and player locking is permission gated", () => {
    let state = utilityState();
    const denied = apply(
      state,
      "player_lock",
      "entity.set_locked",
      { entityId: "item", locked: true },
      { type: "player", playerId: "alice" },
    );
    expect(denied.rejection?.reason).toContain("sandbox");

    state = apply(state, "script_lock", "entity.set_locked", {
      entityId: "item",
      locked: true,
    }).state;
    const grab = apply(
      state,
      "locked_grab",
      "entity.grab",
      { entityId: "item" },
      { type: "player", playerId: "alice" },
    );
    expect(grab.rejection?.reason).toBe("Entity is locked");
  });

  test("all new registered actions reject malformed exact-key payloads atomically", () => {
    const cases = [
      ["entity.move", { entityId: "item", transform: IDENTITY, extra: true }],
      ["entity.set_locked", { entityId: "item", locked: true, extra: true }],
      ["container.move", { entity: "item", from: "source", to: "target" }],
      ["stack.remove_top", { stackId: "missing", extra: true }],
      ["button.press", { entityId: "button", extra: true }],
      ["text.set", { entityId: "text", value: "x", extra: true }],
      ["snap.attach", { snapPointId: "missing", entityId: "item", extra: true }],
    ] as const;
    let state = utilityState();
    for (const [type, payload] of cases) {
      const before = gameplayHash(state);
      const actor = type === "button.press"
        ? { type: "player" as const, playerId: "alice" }
        : { type: "script" as const, scriptId: "game" };
      const result = apply(state, `bad_${state.sequence}`, type, payload, actor);
      expect(result.events.map((event) => event.type)).toEqual(["action.rejected"]);
      expect(gameplayHash(result.state)).toBe(before);
      state = result.state;
    }
  });

  test("new action streams replay deterministically", () => {
    const replay = () => {
      let state = utilityState();
      state = apply(state, "move", "container.move", {
        entity: "item",
        from: "source",
        to: "target",
        index: 0,
      }).state;
      state = apply(state, "world", "container.move", {
        entity: "item",
        from: "target",
        to: null,
        index: 0,
      }).state;
      state = apply(state, "move_entity", "entity.move", {
        entityId: "item",
        transform: transform(2.34567),
      }).state;
      state = apply(state, "set_text", "text.set", { entityId: "text", value: "new" }).state;
      return snapshot(state).stateHash;
    };
    expect(replay()).toBe(replay());
  });
});
