import { canonicalStringify } from "digipology-canonical-json";
import {
  canonicalizeTransform,
  cloneCanonical,
  transformProblem,
} from "./canonical";
import type {
  ActionDefinition,
  ActionInstance,
  CanonicalGameState,
  ContainerComponent,
  CounterComponent,
  EntityId,
  EntityRecord,
  FlippableComponent,
  GrabbableComponent,
  JsonValue,
  Reject,
  Settings,
  TransformComponent,
  ValidationResult,
} from "./types";

const OK: Readonly<{ ok: true }> = Object.freeze({ ok: true });
const hasOwn = Object.prototype.hasOwnProperty;

function reject(reason: string): Reject {
  return { reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function entityPayload(action: ActionInstance<unknown>):
  | { entityId: EntityId }
  | Reject {
  if (
    !isRecord(action.payload) ||
    !onlyKeys(action.payload, ["entityId"]) ||
    typeof action.payload.entityId !== "string"
  ) {
    return reject("Payload must contain only a string entityId");
  }
  return { entityId: action.payload.entityId };
}

function getEntity(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
): EntityRecord | undefined {
  return hasOwn.call(state.entities, entityId) ? state.entities[entityId] : undefined;
}

function requireComponent<T>(
  state: Readonly<CanonicalGameState>,
  entityId: EntityId,
  componentType: string,
): T | Reject {
  const entity = getEntity(state, entityId);
  if (entity === undefined) return reject(`Unknown entity: ${entityId}`);
  const component = entity.components[componentType];
  if (component === undefined) {
    return reject(`Entity ${entityId} lacks ${componentType}`);
  }
  return component as T;
}

function isReject(value: unknown): value is Reject {
  return isRecord(value) && typeof value.reason === "string";
}

function validateSettings(value: unknown): value is Settings {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    const setting = value[key];
    if (
      typeof setting !== "boolean" &&
      typeof setting !== "number" &&
      typeof setting !== "string"
    ) {
      return false;
    }
    if (typeof setting === "number" && !Number.isFinite(setting)) return false;
  }
  return true;
}

const gameStart: ActionDefinition<unknown> = {
  type: "system.game_start",
  version: 1,
  sources: ["system"],
  validate(state, action) {
    if (state.sequence !== 0) return reject("Game has already started");
    if (!isRecord(action.payload) || !onlyKeys(action.payload, ["settings"])) {
      return reject("Payload must be an object with optional settings");
    }
    if (hasOwn.call(action.payload, "settings") && !validateSettings(action.payload.settings)) {
      return reject("settings must contain finite primitive values");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { settings?: Settings };
    if (payload.settings !== undefined) draft.settings = cloneCanonical(payload.settings);
    ctx.emit("game.started", { settings: cloneCanonical(draft.settings) });
  },
};

const entityGrab: ActionDefinition<unknown> = {
  type: "entity.grab",
  version: 1,
  sources: ["player"],
  validate(state, action) {
    const payload = entityPayload(action);
    if (isReject(payload)) return payload;
    const grabbable = requireComponent<GrabbableComponent>(
      state,
      payload.entityId,
      "grabbable",
    );
    if (isReject(grabbable)) return grabbable;
    if (!grabbable.enabled) return reject("Entity is not grabbable");
    if (grabbable.heldBy !== null) return reject("Entity is already held");
    return OK;
  },
  apply(draft, action, ctx) {
    const { entityId } = action.payload as { entityId: string };
    const playerId = (action.actor as { playerId: string }).playerId;
    const grabbable = draft.entities[entityId]?.components.grabbable as
      | GrabbableComponent
      | undefined;
    if (grabbable === undefined) throw new Error("Validated grabbable disappeared");
    grabbable.heldBy = playerId;
    ctx.emit("entity.grabbed", { entityId, playerId });
  },
};

const entityDrop: ActionDefinition<unknown> = {
  type: "entity.drop",
  version: 1,
  sources: ["player"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["entityId", "transform"]) ||
      typeof action.payload.entityId !== "string"
    ) {
      return reject("Payload must contain entityId and transform");
    }
    const grabbable = requireComponent<GrabbableComponent>(
      state,
      action.payload.entityId,
      "grabbable",
    );
    if (isReject(grabbable)) return grabbable;
    const actorId = (action.actor as { playerId?: string }).playerId;
    if (grabbable.heldBy !== actorId) return reject("Actor does not hold entity");
    const problem = transformProblem(action.payload.transform);
    return problem === undefined ? OK : reject(`Invalid transform: ${problem}`);
  },
  apply(draft, action, ctx) {
    const payload = action.payload as {
      entityId: string;
      transform: TransformComponent;
    };
    const entity = draft.entities[payload.entityId];
    const grabbable = entity?.components.grabbable as GrabbableComponent | undefined;
    if (entity === undefined || grabbable === undefined) {
      throw new Error("Validated entity disappeared");
    }
    entity.components.transform = canonicalizeTransform(payload.transform);
    grabbable.heldBy = null;
    const entityIds = Object.keys(draft.entities).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const containerId of entityIds) {
      const container = draft.entities[containerId]?.components.container as
        | ContainerComponent
        | undefined;
      if (container === undefined) continue;
      const index = container.items.indexOf(payload.entityId);
      if (index >= 0) {
        container.items.splice(index, 1);
        ctx.emit("container.removed", {
          containerId,
          entityId: payload.entityId,
          index,
        });
      }
    }
    ctx.emit("entity.dropped", {
      entityId: payload.entityId,
      transform: cloneCanonical(entity.components.transform) as unknown as JsonValue,
    });
  },
};

const entityFlip: ActionDefinition<unknown> = {
  type: "entity.flip",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = entityPayload(action);
    if (isReject(payload)) return payload;
    const flippable = requireComponent<FlippableComponent>(
      state,
      payload.entityId,
      "flippable",
    );
    return isReject(flippable) ? flippable : OK;
  },
  apply(draft, action, ctx) {
    const { entityId } = action.payload as { entityId: string };
    const flippable = draft.entities[entityId]?.components.flippable as
      | FlippableComponent
      | undefined;
    if (flippable === undefined) throw new Error("Validated flippable disappeared");
    flippable.flipped = !flippable.flipped;
    ctx.emit("entity.flipped", { entityId, flipped: flippable.flipped });
  },
};

function validateDeck(state: Readonly<CanonicalGameState>, deckId: string): ValidationResult {
  const entity = getEntity(state, deckId);
  if (entity === undefined) return reject(`Unknown entity: ${deckId}`);
  if (entity.components.deck === undefined || entity.components.container === undefined) {
    return reject(`Entity ${deckId} is not a deck`);
  }
  const deck = entity.components.deck as { enabled?: unknown };
  if (deck.enabled === false) return reject("Deck is disabled");
  return OK;
}

const deckShuffle: ActionDefinition<unknown> = {
  type: "deck.shuffle",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    if (
      !isRecord(action.payload) ||
      !onlyKeys(action.payload, ["deckId"]) ||
      typeof action.payload.deckId !== "string"
    ) {
      return reject("Payload must contain only deckId");
    }
    return validateDeck(state, action.payload.deckId);
  },
  apply(draft, action, ctx) {
    const { deckId } = action.payload as { deckId: string };
    const container = draft.entities[deckId]?.components.container as
      | ContainerComponent
      | undefined;
    if (container === undefined) throw new Error("Validated deck disappeared");
    container.items = ctx.rng.shuffle(container.items);
    ctx.emit("deck.shuffled", { deckId });
  },
};

interface DrawPayload {
  deckId: string;
  target: string;
  count: number;
}

function drawPayload(value: unknown): DrawPayload | Reject {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["deckId", "target", "count"]) ||
    typeof value.deckId !== "string" ||
    typeof value.target !== "string" ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) <= 0
  ) {
    return reject("Payload requires deckId, target, and a positive integer count");
  }
  return value as unknown as DrawPayload;
}

const deckDrawToContainer: ActionDefinition<unknown> = {
  type: "deck.draw_to_container",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = drawPayload(action.payload);
    if (isReject(payload)) return payload;
    const deckResult = validateDeck(state, payload.deckId);
    if (isReject(deckResult)) return deckResult;
    if (payload.deckId === payload.target) return reject("Deck and target must differ");
    const deck = state.entities[payload.deckId]?.components.container as
      | ContainerComponent
      | undefined;
    const target = requireComponent<ContainerComponent>(
      state,
      payload.target,
      "container",
    );
    if (isReject(target)) return target;
    if (deck === undefined || payload.count > deck.items.length) {
      return reject("Deck has insufficient cards");
    }
    if (
      target.capacity !== null &&
      target.items.length + payload.count > target.capacity
    ) {
      return reject("Target container has insufficient capacity");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as DrawPayload;
    const deck = draft.entities[payload.deckId]?.components.container as
      | ContainerComponent
      | undefined;
    const target = draft.entities[payload.target]?.components.container as
      | ContainerComponent
      | undefined;
    if (deck === undefined || target === undefined) {
      throw new Error("Validated container disappeared");
    }
    const drawn: string[] = [];
    for (let index = 0; index < payload.count; index += 1) {
      const cardId = deck.items.pop();
      if (cardId === undefined) throw new Error("Validated deck became insufficient");
      target.items.push(cardId);
      drawn.push(cardId);
    }
    ctx.emit("deck.drawn", {
      deckId: payload.deckId,
      target: payload.target,
      count: payload.count,
      items: drawn,
    });
  },
};

interface CounterPayload {
  entityId: string;
  amount: number;
}

function counterPayload(
  state: Readonly<CanonicalGameState>,
  action: ActionInstance<unknown>,
  field: "value" | "amount",
): CounterPayload | Reject {
  if (
    !isRecord(action.payload) ||
    !onlyKeys(action.payload, ["entityId", field]) ||
    typeof action.payload.entityId !== "string" ||
    typeof action.payload[field] !== "number" ||
    !Number.isFinite(action.payload[field])
  ) {
    return reject(`Payload requires entityId and finite ${field}`);
  }
  const counter = requireComponent<CounterComponent>(
    state,
    action.payload.entityId,
    "counter",
  );
  if (isReject(counter)) return counter;
  return {
    entityId: action.payload.entityId,
    amount: action.payload[field] as number,
  };
}

function clamped(counter: CounterComponent, value: number): number {
  let result = value;
  if (counter.min !== null && result < counter.min) result = counter.min;
  if (counter.max !== null && result > counter.max) result = counter.max;
  return Object.is(result, -0) ? 0 : result;
}

function applyCounter(
  draft: CanonicalGameState,
  entityId: string,
  next: (current: number) => number,
): number {
  const counter = draft.entities[entityId]?.components.counter as
    | CounterComponent
    | undefined;
  if (counter === undefined) throw new Error("Validated counter disappeared");
  counter.value = clamped(counter, next(counter.value));
  return counter.value;
}

const counterSet: ActionDefinition<unknown> = {
  type: "counter.set",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = counterPayload(state, action, "value");
    return isReject(payload) ? payload : OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { entityId: string; value: number };
    const value = applyCounter(draft, payload.entityId, () => payload.value);
    ctx.emit("counter.changed", { entityId: payload.entityId, value });
  },
};

const counterAdd: ActionDefinition<unknown> = {
  type: "counter.add",
  version: 1,
  sources: ["player", "script"],
  validate(state, action) {
    const payload = counterPayload(state, action, "amount");
    if (isReject(payload)) return payload;
    const counter = state.entities[payload.entityId]?.components.counter as
      | CounterComponent
      | undefined;
    if (counter === undefined || !Number.isFinite(counter.value + payload.amount)) {
      return reject("Counter result must be finite");
    }
    return OK;
  },
  apply(draft, action, ctx) {
    const payload = action.payload as { entityId: string; amount: number };
    const value = applyCounter(
      draft,
      payload.entityId,
      (current) => current + payload.amount,
    );
    ctx.emit("counter.changed", { entityId: payload.entityId, value });
  },
};

export const builtInActions: ReadonlyArray<ActionDefinition<unknown>> = [
  gameStart,
  entityGrab,
  entityDrop,
  entityFlip,
  deckShuffle,
  deckDrawToContainer,
  counterSet,
  counterAdd,
];

/** Add a new entity using the current action's deterministic allocation stream. */
export function spawnEntity(
  draft: CanonicalGameState,
  components: EntityRecord["components"],
  allocateEntityId: () => EntityId,
): EntityRecord {
  canonicalStringify(components);
  const id = allocateEntityId();
  const entity: EntityRecord = { id, components: cloneCanonical(components) };
  draft.entities[id] = entity;
  return entity;
}

/** Permanently remove an entity and every canonical container membership. */
export function destroyEntity(draft: CanonicalGameState, entityId: EntityId): void {
  if (!hasOwn.call(draft.entities, entityId)) throw new Error(`Unknown entity: ${entityId}`);
  const ids = Object.keys(draft.entities).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const id of ids) {
    const container = draft.entities[id]?.components.container as
      | ContainerComponent
      | undefined;
    if (container !== undefined) {
      container.items = container.items.filter((itemId) => itemId !== entityId);
    }
  }
  delete draft.entities[entityId];
}
