import {
  PROTOCOL_VERSION,
  type ActionRequest,
  type PlayerInfo,
  type OrderedAction,
  type ResumeMessage,
  type ServerMessage,
} from "digipology-protocol";
import type { GameSnapshot } from "digipology-kernel";

export const ACTION_RETENTION = 500;

export interface RoomCoreState {
  lastSequence: number;
  actions: OrderedAction[];
}

export type SequenceResult =
  | { duplicate: true; orderedAction: OrderedAction; state: RoomCoreState }
  | { duplicate: false; orderedAction: OrderedAction; state: RoomCoreState };

export type ResumeResult =
  | { type: "resume"; message: ResumeMessage }
  | { type: "resync_required" }
  | { type: "invalid_sequence" };

export class RoomCore {
  readonly #roomShortId: string;
  #state: RoomCoreState;

  constructor(roomShortId: string, state: RoomCoreState = emptyRoomCoreState()) {
    assertState(state);
    this.#roomShortId = roomShortId;
    this.#state = cloneState(state);
  }

  get state(): RoomCoreState {
    return cloneState(this.#state);
  }

  sequence(request: ActionRequest, playerId: string): SequenceResult {
    const existing = this.#state.actions.find(
      (action) => action.requestId === request.requestId,
    );
    if (existing !== undefined) {
      return {
        duplicate: true,
        orderedAction: existing,
        state: this.state,
      };
    }

    if (this.#state.lastSequence >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Room sequence is exhausted");
    }
    const sequence = this.#state.lastSequence + 1;
    const orderedAction: OrderedAction = {
      type: "ordered_action",
      protocolVersion: PROTOCOL_VERSION,
      sequence,
      actionId: `act_${this.#roomShortId}_${sequence}`,
      requestId: request.requestId,
      actor: { type: "player", playerId },
      action: request.action,
    };
    const actions = [...this.#state.actions, orderedAction].slice(
      -ACTION_RETENTION,
    );
    this.#state = { lastSequence: sequence, actions };
    return {
      duplicate: false,
      orderedAction,
      state: this.state,
    };
  }

  /** Sequence a trusted DO-originated action, idempotently keyed by its lifecycle cause. */
  sequenceSystem(
    action: ActionRequest["action"],
    dedupKey: string,
  ): SequenceResult {
    if (dedupKey.length === 0) throw new TypeError("System action dedup key is required");
    const actionId = `sys_${this.#roomShortId}_${dedupKey}`;
    const existing = this.#state.actions.find(
      (candidate) => candidate.actionId === actionId,
    );
    if (existing !== undefined) {
      return { duplicate: true, orderedAction: existing, state: this.state };
    }
    if (this.#state.lastSequence >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Room sequence is exhausted");
    }
    const sequence = this.#state.lastSequence + 1;
    const orderedAction: OrderedAction = {
      type: "ordered_action",
      protocolVersion: PROTOCOL_VERSION,
      sequence,
      actionId,
      actor: { type: "system" },
      action,
    };
    this.#state = {
      lastSequence: sequence,
      actions: [...this.#state.actions, orderedAction].slice(-ACTION_RETENTION),
    };
    return { duplicate: false, orderedAction, state: this.state };
  }

  resumeAfter(lastSequence: number): ResumeResult {
    if (
      !Number.isSafeInteger(lastSequence) ||
      lastSequence < 0 ||
      lastSequence > this.#state.lastSequence
    ) {
      return { type: "invalid_sequence" };
    }
    const floor = retentionFloor(this.#state);
    if (lastSequence < floor - 1) return { type: "resync_required" };

    return {
      type: "resume",
      message: {
        type: "resume",
        protocolVersion: PROTOCOL_VERSION,
        fromSequence: lastSequence + 1,
        actions: this.#state.actions.filter(
          (action) => action.sequence > lastSequence,
        ),
      },
    };
  }
}

export function emptyRoomCoreState(): RoomCoreState {
  return { lastSequence: 0, actions: [] };
}

export function retentionFloor(state: RoomCoreState): number {
  return state.actions[0]?.sequence ?? state.lastSequence + 1;
}

export function roomBootstrapMessages(
  initialSnapshot: GameSnapshot,
  players: PlayerInfo[],
  actions: readonly OrderedAction[],
): readonly ServerMessage[] {
  return [
    {
      type: "bootstrap",
      protocolVersion: PROTOCOL_VERSION,
      sequence: initialSnapshot.sequence,
      snapshot: initialSnapshot,
      players,
    },
    ...actions,
  ];
}

function cloneState(state: RoomCoreState): RoomCoreState {
  return { lastSequence: state.lastSequence, actions: [...state.actions] };
}

function assertState(state: RoomCoreState): void {
  if (!Number.isSafeInteger(state.lastSequence) || state.lastSequence < 0) {
    throw new TypeError("lastSequence must be a non-negative safe integer");
  }
  if (state.actions.length > ACTION_RETENTION) {
    throw new TypeError("action window exceeds retention limit");
  }
  let previous = state.lastSequence - state.actions.length;
  const requestIds = new Set<string>();
  const actionIds = new Set<string>();
  for (const action of state.actions) {
    if (action.sequence !== previous + 1) {
      throw new TypeError("action window must be contiguous");
    }
    if (actionIds.has(action.actionId)) {
      throw new TypeError("retained actions need unique action IDs");
    }
    actionIds.add(action.actionId);
    if (action.actor.type === "player" && action.requestId === undefined) {
      throw new TypeError("retained client actions need request IDs");
    }
    if (action.requestId !== undefined) {
      if (requestIds.has(action.requestId)) {
        throw new TypeError("retained client actions need unique request IDs");
      }
      requestIds.add(action.requestId);
    }
    previous = action.sequence;
  }
  if (state.actions.length > 0 && previous !== state.lastSequence) {
    throw new TypeError("action window must end at lastSequence");
  }
}
