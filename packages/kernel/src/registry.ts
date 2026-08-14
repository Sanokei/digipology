import { canonicalStringify, hashValue } from "digipology-canonical-json";
import { fromState } from "digipology-prng";
import { builtInActions } from "./actions";
import {
  cloneCanonical,
  validateCanonicalGameState,
} from "./canonical";
import type {
  ActionDefinition,
  ActionInstance,
  ActionSource,
  ApplyContext,
  ApplyOrderedResult,
  CanonicalGameState,
  GameSnapshot,
  JsonValue,
  KernelEvent,
  OrderedActionInput,
  Settings,
} from "./types";
import type { RngState } from "digipology-prng";

export class SequenceError extends Error {
  constructor(expected: number, actual: number) {
    super(`Expected ordered sequence ${expected}, received ${actual}`);
    this.name = "SequenceError";
  }
}

export class ActionRegistry {
  private readonly definitions = new Map<string, ActionDefinition<unknown>>();

  register<P>(definition: ActionDefinition<P>): void {
    if (typeof definition.type !== "string" || definition.type.length === 0) {
      throw new TypeError("Action type must be a non-empty string");
    }
    if (definition.version !== 1) throw new TypeError("Action version must equal 1");
    if (this.definitions.has(definition.type)) {
      throw new Error(`Action type already registered: ${definition.type}`);
    }
    const validSources: readonly ActionSource[] = ["player", "script", "system"];
    if (
      definition.sources.length === 0 ||
      definition.sources.some((source) => !validSources.includes(source))
    ) {
      throw new TypeError("Action sources must contain supported source types");
    }
    this.definitions.set(
      definition.type,
      definition as unknown as ActionDefinition<unknown>,
    );
  }

  get(type: string): ActionDefinition<unknown> | undefined {
    return this.definitions.get(type);
  }

  types(): string[] {
    return Array.from(this.definitions.keys()).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
  }
}

export const defaultActionRegistry = new ActionRegistry();
for (const definition of builtInActions) defaultActionRegistry.register(definition);

export function registerAction<P>(definition: ActionDefinition<P>): void {
  defaultActionRegistry.register(definition);
}

function rejected(
  state: CanonicalGameState,
  ordered: OrderedActionInput<unknown>,
  reason: string,
): ApplyOrderedResult {
  const actionType =
    typeof ordered.action === "object" &&
    ordered.action !== null &&
    typeof ordered.action.type === "string"
      ? ordered.action.type
      : null;
  const next = cloneCanonical(state);
  next.sequence = ordered.sequence;
  validateCanonicalGameState(next);
  return {
    state: next,
    events: [
      {
        type: "action.rejected",
        sequence: ordered.sequence,
        actionId: ordered.actionId,
        data: { actionType, reason },
      },
    ],
    rejection: { reason },
  };
}

function inputProblem(ordered: OrderedActionInput<unknown>): string | undefined {
  try {
    canonicalStringify(ordered);
  } catch {
    return "Ordered action must contain only canonical values";
  }
  if (typeof ordered.actionId !== "string" || ordered.actionId.length === 0) {
    return "actionId must be a non-empty string";
  }
  if (
    typeof ordered.actor !== "object" ||
    ordered.actor === null ||
    !["player", "script", "system"].includes(ordered.actor.type)
  ) {
    return "Actor source is invalid";
  }
  if (
    ordered.actor.type === "player" &&
    (typeof ordered.actor.playerId !== "string" || ordered.actor.playerId.length === 0)
  ) {
    return "Player actor requires playerId";
  }
  if (
    typeof ordered.action !== "object" ||
    ordered.action === null ||
    typeof ordered.action.type !== "string" ||
    ordered.action.type.length === 0
  ) {
    return "Action type must be a non-empty string";
  }
  if (!Object.prototype.hasOwnProperty.call(ordered.action, "payload")) {
    return "Action payload is required";
  }
  return undefined;
}

export function applyOrderedWithRegistry(
  state: CanonicalGameState,
  ordered: OrderedActionInput<unknown>,
  registry: ActionRegistry,
): ApplyOrderedResult {
  validateCanonicalGameState(state);
  const expected = state.sequence + 1;
  if (ordered.sequence !== expected) throw new SequenceError(expected, ordered.sequence);

  const malformed = inputProblem(ordered);
  if (malformed !== undefined) return rejected(state, ordered, malformed);
  const definition = registry.get(ordered.action.type);
  if (definition === undefined) {
    return rejected(state, ordered, `Unknown action type: ${ordered.action.type}`);
  }
  if (!definition.sources.includes(ordered.actor.type)) {
    return rejected(
      state,
      ordered,
      `Action ${ordered.action.type} does not allow source ${ordered.actor.type}`,
    );
  }

  const draft = cloneCanonical(state);
  draft.sequence = ordered.sequence;
  const validationState = cloneCanonical(state);
  const instance: ActionInstance<unknown> = {
    sequence: ordered.sequence,
    actionId: ordered.actionId,
    actor: cloneCanonical(ordered.actor),
    type: ordered.action.type,
    payload: cloneCanonical(ordered.action.payload),
  };
  let validation;
  try {
    validation = definition.validate(validationState, instance);
  } catch {
    return rejected(state, ordered, "Action validation failed");
  }
  if (validation.ok !== true) return rejected(state, ordered, validation.reason);

  const events: KernelEvent[] = [];
  const rng = fromState(draft.rng);
  let spawnIndex = 0;
  const allocated = new Set<string>();
  const context: ApplyContext = {
    rng,
    allocateEntityId() {
      while (true) {
        const candidate = `ent_${ordered.actionId}_${spawnIndex}`;
        spawnIndex += 1;
        if (!(candidate in draft.entities) && !allocated.has(candidate)) {
          allocated.add(candidate);
          return candidate;
        }
      }
    },
    emit(type, data = {}) {
      canonicalStringify(data);
      events.push({
        type,
        sequence: ordered.sequence,
        actionId: ordered.actionId,
        data: cloneCanonical(data),
      });
    },
  };

  try {
    definition.apply(draft, instance, context);
    draft.rng = rng.state();
    validateCanonicalGameState(draft);
  } catch {
    return rejected(state, ordered, "Action application failed");
  }
  return { state: draft, events };
}

export function applyOrdered(
  state: CanonicalGameState,
  ordered: OrderedActionInput<unknown>,
): ApplyOrderedResult {
  return applyOrderedWithRegistry(state, ordered, defaultActionRegistry);
}

export function createInitialState(input: {
  releaseId: string;
  rng: RngState;
  settings?: Settings;
  players?: CanonicalGameState["players"];
  seats?: CanonicalGameState["seats"];
  entities?: CanonicalGameState["entities"];
  scriptState?: JsonValue;
  prompts?: CanonicalGameState["prompts"];
}): CanonicalGameState {
  const state: CanonicalGameState = {
    schemaVersion: 1,
    sequence: 0,
    releaseId: input.releaseId,
    kernelVersion: 1,
    settings: cloneCanonical(input.settings ?? {}),
    rng: cloneCanonical(input.rng),
    players: cloneCanonical(input.players ?? {}),
    seats: cloneCanonical(input.seats ?? {}),
    entities: cloneCanonical(input.entities ?? {}),
    scriptState: cloneCanonical(input.scriptState ?? {}),
    prompts: cloneCanonical(input.prompts ?? {}),
  };
  validateCanonicalGameState(state);
  return state;
}

export function snapshot(state: CanonicalGameState): GameSnapshot {
  validateCanonicalGameState(state);
  const detached = cloneCanonical(state);
  return {
    formatVersion: 1,
    kernelVersion: 1,
    releaseId: detached.releaseId,
    sequence: detached.sequence,
    state: detached,
    stateHash: hashValue(detached),
  };
}

export function loadSnapshot(value: GameSnapshot): CanonicalGameState {
  canonicalStringify(value);
  if (
    value.formatVersion !== 1 ||
    value.kernelVersion !== 1 ||
    value.releaseId !== value.state.releaseId ||
    value.sequence !== value.state.sequence
  ) {
    throw new TypeError("Snapshot metadata does not match its state");
  }
  validateCanonicalGameState(value.state);
  if (hashValue(value.state) !== value.stateHash) {
    throw new TypeError("Snapshot state hash does not match its state");
  }
  return cloneCanonical(value.state);
}
