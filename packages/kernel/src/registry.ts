import { canonicalStringify, hashValue } from "digipology-canonical-json";
import { fromState } from "digipology-prng";
import { builtInActions } from "./actions";
import {
  cloneCanonical,
  validateCanonicalGameState,
} from "./canonical";
import type {
  ActionDefinition,
  ActionInput,
  ActionInstance,
  ActionRegistryOptions,
  ActionSource,
  ActionValidationContext,
  ApplyContext,
  ApplyOrderedResult,
  CanonicalGameState,
  GameSnapshot,
  JsonValue,
  KernelEvent,
  OrderedActionInput,
  Settings,
  ScriptBinding,
  ScriptDiagnostic,
  ScriptRuntime,
  ScriptTransactionOptions,
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
  private readonly validationContext: ActionValidationContext;

  constructor(options: ActionRegistryOptions = {}) {
    this.validationContext = Object.freeze({
      canGrab: options.canGrab ?? options.can_grab ?? (() => true),
      canDrop: options.canDrop ?? options.can_drop ?? (() => true),
      canFlip: options.canFlip ?? options.can_flip ?? (() => true),
      canPress: options.canPress ?? options.can_press ?? (() => true),
    });
  }

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

  validateContext(): ActionValidationContext {
    return this.validationContext;
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
    validation = definition.validate(
      validationState,
      instance,
      registry.validateContext(),
    );
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

interface CallbackDelivery {
  functionName: string;
  entityId?: string;
  context: { [key: string]: JsonValue };
  bindingId?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function eventDeliveries(event: KernelEvent): CallbackDelivery[] {
  const entity = (functionName: string, key = "entityId"): CallbackDelivery[] => {
    const entityId = event.data[key];
    return typeof entityId === "string"
      ? [{ functionName, entityId, context: cloneCanonical(event.data) }]
      : [];
  };
  switch (event.type) {
    case "game.started": return [{ functionName: "on_start", context: cloneCanonical(event.data) }];
    case "player.joined": return [{ functionName: "on_player_join", context: cloneCanonical(event.data) }];
    case "entity.grabbed": return entity("on_grab");
    case "entity.dropped": return entity("on_drop");
    case "entity.flipped": return entity("on_flip");
    case "die.rolled": return entity("on_roll");
    case "button.pressed": return entity("on_press");
    case "zone.entered": return entity("on_enter", "zoneId");
    case "zone.left": return entity("on_leave", "zoneId");
    case "container.moved": {
      const result: CallbackDelivery[] = [];
      if (typeof event.data.from === "string") result.push({
        functionName: "on_container_remove",
        entityId: event.data.from,
        context: cloneCanonical(event.data),
      });
      if (typeof event.data.to === "string") result.push({
        functionName: "on_container_add",
        entityId: event.data.to,
        context: cloneCanonical(event.data),
      });
      return result;
    }
    case "deck.drawn": {
      const items = Array.isArray(event.data.items) ? event.data.items : [];
      const deckId = event.data.deckId;
      const target = event.data.target;
      const result: CallbackDelivery[] = [];
      for (const item of items) {
        if (typeof item !== "string") continue;
        if (typeof deckId === "string") result.push({
          functionName: "on_container_remove", entityId: deckId,
          context: { ...cloneCanonical(event.data), entity: item },
        });
        if (typeof target === "string") result.push({
          functionName: "on_container_add", entityId: target,
          context: { ...cloneCanonical(event.data), entity: item },
        });
      }
      return result;
    }
    case "prompt.responded": return [{ functionName: "on_prompt", context: cloneCanonical(event.data) }];
    case "timer.fired": return typeof event.data.callback === "string" && typeof event.data.bindingId === "string"
      ? [{
          functionName: event.data.callback,
          bindingId: event.data.bindingId,
          ...(typeof event.data.entityId === "string" ? { entityId: event.data.entityId } : {}),
          context: cloneCanonical(event.data),
        }]
      : [];
    default: return [];
  }
}

function guardForAction(ordered: OrderedActionInput<unknown>): { name: string; entityId: string } | undefined {
  if (ordered.actor.type !== "player" || typeof ordered.action.payload !== "object" ||
    ordered.action.payload === null || Array.isArray(ordered.action.payload)) return undefined;
  const entityId = (ordered.action.payload as { entityId?: unknown }).entityId;
  if (typeof entityId !== "string") return undefined;
  const name = ordered.action.type === "entity.grab" ? "can_grab"
    : ordered.action.type === "entity.drop" ? "can_drop"
      : ordered.action.type === "entity.flip" ? "can_flip"
        : ordered.action.type === "button.press" ? "can_press"
          : undefined;
  return name === undefined ? undefined : { name, entityId };
}

function scriptRejected(
  state: CanonicalGameState,
  ordered: OrderedActionInput<unknown>,
  reason: string,
  binding: ScriptBinding,
  functionName: string,
  diagnostic: ScriptDiagnostic,
): ApplyOrderedResult {
  const result = rejected(state, ordered, reason);
  result.events.push({
    type: "script.error",
    sequence: ordered.sequence,
    actionId: ordered.actionId,
    data: {
      script: binding.scriptId,
      binding: binding.bindingId,
      function: functionName,
      line: diagnostic.line ?? null,
      message: diagnostic.message,
      kind: diagnostic.kind,
      sequence: ordered.sequence,
    },
  });
  return result;
}

/**
 * Apply an ordered action and all Lua-generated work as one transaction.
 * The sync applyOrdered path remains available for releases without bindings.
 */
export async function applyOrderedWithScripts(
  state: CanonicalGameState,
  ordered: OrderedActionInput<unknown>,
  options: ScriptTransactionOptions,
  registry: ActionRegistry = defaultActionRegistry,
): Promise<ApplyOrderedResult> {
  validateCanonicalGameState(state);
  const runtime = options.runtime;
  const maxCommands = options.maxCommands ?? 1_024;
  if (!Number.isSafeInteger(maxCommands) || maxCommands <= 0) {
    throw new RangeError("maxCommands must be a positive safe integer");
  }
  let bindings: ScriptBinding[];
  try {
    bindings = [...runtime.bindings(cloneCanonical(state))].sort(
      (left, right) => compareText(left.bindingId, right.bindingId),
    );
  } catch (error) {
    const fallback: ScriptBinding = { scriptId: "runtime", bindingId: "runtime", props: {} };
    return scriptRejected(state, ordered, "Script binding discovery failed", fallback, "bindings", {
      kind: "runtime",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const guard = guardForAction(ordered);
  if (guard !== undefined) {
    for (const binding of bindings.filter((candidate) => candidate.entityId === guard.entityId)) {
      const commands: ActionInput<JsonValue>[] = [];
      let result;
      try {
        result = await runtime.invoke({
          state: cloneCanonical(state),
          scriptState: cloneCanonical(state.scriptState),
          binding,
          functionName: guard.name,
          context: {
            actionType: ordered.action.type,
            actor: cloneCanonical(ordered.actor) as unknown as JsonValue,
            entityId: guard.entityId,
          },
          readOnly: true,
          bridge: {
            queue(action) { commands.push(action); },
            randomInt() { throw new Error("guards cannot consume canonical randomness"); },
            randomFloat() { throw new Error("guards cannot consume canonical randomness"); },
            allocateTimerId() { throw new Error("guards cannot create timers"); },
          },
        });
      } catch (error) {
        result = {
          ok: false,
          error: { kind: "runtime", message: error instanceof Error ? error.message : String(error) },
        };
      }
      if (!result.ok || commands.length !== 0) {
        const diagnostic = result.error ?? {
          kind: "runtime",
          message: "guards cannot queue canonical mutations",
        };
        return scriptRejected(state, ordered, diagnostic.message, binding, guard.name, diagnostic);
      }
      if (result.handled === true && result.allowed === false) {
        return rejected(state, ordered, result.reason ?? `${guard.name} denied the action`);
      }
    }
  }

  const base = applyOrderedWithRegistry(state, ordered, registry);
  if (base.rejection !== undefined || bindings.length === 0) return base;

  const draft = base.state;
  const events = [...base.events];
  const rng = fromState(draft.rng);
  let commandCount = 0;
  let timerIndex = 0;
  let eventIndex = 0;

  const applyCommand = (
    command: ActionInput<JsonValue>,
    binding: ScriptBinding,
    functionName: string,
  ): ScriptDiagnostic | undefined => {
    commandCount += 1;
    if (commandCount > maxCommands) return {
      kind: "command_budget_exceeded",
      message: `Script command budget of ${maxCommands} exceeded`,
    };
    const definition = registry.get(command.type);
    if (definition === undefined) return { kind: "validation", message: `Unknown action type: ${command.type}` };
    if (!definition.sources.includes("script")) return {
      kind: "validation",
      message: `Action ${command.type} does not allow source script`,
    };
    let payload: JsonValue;
    try {
      canonicalStringify(command.payload);
      payload = cloneCanonical(command.payload);
    } catch {
      return { kind: "validation", message: "Script command payload must be canonical" };
    }
    const instance: ActionInstance<unknown> = {
      sequence: ordered.sequence,
      actionId: ordered.actionId,
      actor: { type: "script", scriptId: binding.scriptId },
      type: command.type,
      payload,
    };
    let validation;
    try {
      validation = definition.validate(cloneCanonical(draft), instance, registry.validateContext());
    } catch (error) {
      return { kind: "validation", message: error instanceof Error ? error.message : String(error) };
    }
    if (validation.ok !== true) return { kind: "validation", message: validation.reason };
    const context: ApplyContext = {
      rng,
      allocateEntityId() {
        throw new Error("Entity allocation is not exposed by Lua API v1");
      },
      emit(type, data = {}) {
        canonicalStringify(data);
        events.push({ type, sequence: ordered.sequence, actionId: ordered.actionId, data: cloneCanonical(data) });
      },
    };
    try {
      definition.apply(draft, instance, context);
      validateCanonicalGameState(draft);
      return undefined;
    } catch (error) {
      return { kind: "application", message: error instanceof Error ? error.message : String(error) };
    }
  };

  while (eventIndex < events.length) {
    const event = events[eventIndex++];
    if (event === undefined) break;
    for (const delivery of eventDeliveries(event)) {
      const subscribers = bindings.filter((binding) =>
        (delivery.bindingId === undefined || binding.bindingId === delivery.bindingId) &&
        (delivery.entityId === undefined || binding.entityId === delivery.entityId),
      );
      for (const binding of subscribers) {
        const commands: ActionInput<JsonValue>[] = [];
        let invocation;
        try {
          invocation = await runtime.invoke({
            state: cloneCanonical(draft),
            scriptState: cloneCanonical(draft.scriptState),
            binding,
            functionName: delivery.functionName,
            context: {
              ...cloneCanonical(delivery.context),
              actor: cloneCanonical(ordered.actor) as unknown as JsonValue,
            },
            readOnly: false,
            bridge: {
              queue(action) { commands.push(cloneCanonical(action)); },
              randomInt(min, max) { return rng.int(min, max); },
              randomFloat() { return rng.float(); },
              allocateTimerId() {
                const id = `timer_${ordered.actionId}_${timerIndex}`;
                timerIndex += 1;
                return id;
              },
            },
          });
        } catch (error) {
          invocation = {
            ok: false,
            error: { kind: "runtime", message: error instanceof Error ? error.message : String(error) },
          };
        }
        if (!invocation.ok) {
          const diagnostic = invocation.error ?? { kind: "runtime", message: "Script invocation failed" };
          return scriptRejected(state, ordered, diagnostic.message, binding, delivery.functionName, diagnostic);
        }
        if (invocation.scriptState !== undefined) {
          try {
            canonicalStringify(invocation.scriptState);
            draft.scriptState = cloneCanonical(invocation.scriptState);
          } catch {
            return scriptRejected(state, ordered, "Persistent script state must be canonical", binding, delivery.functionName, {
              kind: "extraction", message: "Persistent script state must be canonical",
            });
          }
        }
        for (const command of commands) {
          const failure = applyCommand(command, binding, delivery.functionName);
          if (failure !== undefined) {
            return scriptRejected(state, ordered, failure.message, binding, delivery.functionName, failure);
          }
        }
      }
    }
  }
  draft.rng = rng.state();
  try {
    validateCanonicalGameState(draft);
  } catch (error) {
    const binding = bindings[0] ?? { scriptId: "runtime", bindingId: "runtime", props: {} };
    return scriptRejected(state, ordered, "Script transaction produced invalid state", binding, "transaction", {
      kind: "application", message: error instanceof Error ? error.message : String(error),
    });
  }
  return { state: draft, events };
}

export function createInitialState(input: {
  releaseId: string;
  rng: RngState;
  settings?: Settings;
  players?: CanonicalGameState["players"];
  seats?: CanonicalGameState["seats"];
  entities?: CanonicalGameState["entities"];
  stacks?: NonNullable<CanonicalGameState["stacks"]>;
  scriptState?: JsonValue;
  prompts?: CanonicalGameState["prompts"];
  timers?: NonNullable<CanonicalGameState["timers"]>;
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
    ...(input.stacks === undefined ? {} : { stacks: cloneCanonical(input.stacks) }),
    scriptState: cloneCanonical(input.scriptState ?? {}),
    prompts: cloneCanonical(input.prompts ?? {}),
    ...(input.timers === undefined ? {} : { timers: cloneCanonical(input.timers) }),
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
