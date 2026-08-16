import {
  PROTOCOL_VERSION,
  type ActionRequest,
  type PlayerInfo,
  type OrderedAction,
  type ResumeMessage,
  type ServerMessage,
} from "digipology-protocol";
import {
  ACTION_RETENTION as PROTOCOL_ACTION_RETENTION,
  CHECKPOINT_ATTESTATION_INTERVAL,
} from "digipology-protocol/http";
import {
  applyOrdered,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
} from "digipology-kernel";
import { hashValue } from "digipology-canonical-json";

export const ACTION_RETENTION = PROTOCOL_ACTION_RETENTION;

/**
 * Dedup key for a `system.timer_fire` sequenced by the room alarm. The kernel
 * derives new timer ids from the firing action's id (`timer_<actionId>_<n>`), so
 * a callback that re-arms its own timer would otherwise grow the id by one hop
 * per fire until it exceeds the canonical timer id limit. Hashing keeps every
 * hop the same length while staying idempotent per timer id.
 */
export function timerFireDedupKey(timerId: string): string {
  return `timer_fire_${hashValue(timerId).slice("sha256:".length, "sha256:".length + 32)}`;
}
export const CHECKPOINT_INTERVAL = CHECKPOINT_ATTESTATION_INTERVAL;
export const CHECKPOINT_SOLO_GRACE_MS = 5 * 60 * 1_000;
export const TIMER_CANCEL_GRACE_MS = 350;

if (CHECKPOINT_INTERVAL >= ACTION_RETENTION) {
  throw new Error("CHECKPOINT_INTERVAL must be less than ACTION_RETENTION");
}

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

export interface CheckpointCandidate {
  sequence: number;
  stateHash: string;
  snapshotJson: string;
  attesters: Set<string>;
  conflicted: boolean;
}

export interface CheckpointAttestation {
  sequence: number;
  stateHash: string;
  snapshotJson: string;
  playerId: string;
}

export type CheckpointAttestationResult = {
  status: "recorded" | "duplicate" | "divergent" | "conflicted" | "confirmed";
  candidate: CheckpointCandidate;
};

export type BootstrapPlan =
  | { type: "initial-tail"; baseSequence: number }
  | { type: "checkpoint-tail"; baseSequence: number }
  | { type: "full-log"; baseSequence: number };

export class ScriptedBootstrapUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptedBootstrapUnavailableError";
  }
}

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
  bootstrapSnapshot: GameSnapshot,
  players: PlayerInfo[],
  actions: readonly OrderedAction[],
): readonly ServerMessage[] {
  return [
    {
      type: "bootstrap",
      protocolVersion: PROTOCOL_VERSION,
      sequence: bootstrapSnapshot.sequence,
      snapshot: bootstrapSnapshot,
      players,
    },
    ...actions,
  ];
}

export function checkpointIsDue(
  checkpointSequence: number,
  lastSequence: number,
): boolean {
  return lastSequence - checkpointSequence >= CHECKPOINT_INTERVAL;
}

/** Validate an attested snapshot at the worker's rule-free trust boundary. */
export function validateCheckpointAttestationSnapshot(
  attestation: { sequence: number; stateHash: string; snapshot: GameSnapshot },
  releaseId: string,
  state: RoomCoreState,
): void {
  if (!Number.isSafeInteger(attestation.sequence) || attestation.sequence <= 0 ||
    attestation.sequence % CHECKPOINT_INTERVAL !== 0 || typeof attestation.stateHash !== "string") {
    throw new TypeError("Checkpoint cadence metadata is invalid");
  }
  loadSnapshot(attestation.snapshot);
  if (attestation.snapshot.releaseId !== releaseId ||
    attestation.snapshot.sequence !== attestation.sequence ||
    attestation.snapshot.stateHash !== attestation.stateHash) {
    throw new TypeError("Checkpoint metadata does not match the room");
  }
  if (!checkpointBaseConnects(attestation.sequence, state)) {
    throw new RangeError("Checkpoint sequence is outside the retained window");
  }
}

/**
 * Friendly-mode checkpoint consensus. Two distinct connected players are
 * required when available; a room with one connected player self-confirms.
 */
export function attestCheckpointCandidate(
  existing: CheckpointCandidate | null,
  attestation: CheckpointAttestation,
  connectedPlayerIds: readonly string[],
  options: {
    now?: number;
    lastMultiBootstrapAt?: number | null;
    soloGraceMs?: number;
  } = {},
): CheckpointAttestationResult {
  const connected = new Set(connectedPlayerIds);
  if (!connected.has(attestation.playerId)) {
    throw new Error("Checkpoint attester is not connected");
  }
  if (existing !== null && existing.sequence !== attestation.sequence) {
    throw new Error("Checkpoint candidate sequence does not match attestation");
  }

  const duplicate = existing?.attesters.has(attestation.playerId) ?? false;
  const candidate: CheckpointCandidate = existing === null
    ? {
        sequence: attestation.sequence,
        stateHash: attestation.stateHash,
        snapshotJson: attestation.snapshotJson,
        attesters: new Set([attestation.playerId]),
        conflicted: false,
      }
    : {
        ...existing,
        attesters: new Set(existing.attesters),
      };

  if (candidate.stateHash !== attestation.stateHash) {
    candidate.conflicted = true;
    return { status: "divergent", candidate };
  }
  if (candidate.conflicted) return { status: "conflicted", candidate };

  candidate.attesters.add(attestation.playerId);
  const healthyAttesters = [...candidate.attesters]
    .filter((playerId) => connected.has(playerId)).length;
  const lastMultiBootstrapAt = options.lastMultiBootstrapAt ?? null;
  const soloGraceElapsed = lastMultiBootstrapAt === null ||
    (options.now ?? 0) - lastMultiBootstrapAt >=
      (options.soloGraceMs ?? CHECKPOINT_SOLO_GRACE_MS);
  const required = connected.size === 1 && soloGraceElapsed ? 1 : 2;
  if (healthyAttesters >= required) return { status: "confirmed", candidate };
  return { status: duplicate ? "duplicate" : "recorded", candidate };
}

export function bootstrapPlan(input: {
  initialSequence: number;
  needsRecoveryBase: boolean;
  scripted: boolean;
  checkpointSequence: number | null;
}): BootstrapPlan {
  if (!input.needsRecoveryBase) {
    return { type: "initial-tail", baseSequence: input.initialSequence };
  }
  if (input.checkpointSequence !== null) {
    return { type: "checkpoint-tail", baseSequence: input.checkpointSequence };
  }
  return input.scripted
    ? { type: "full-log", baseSequence: input.initialSequence }
    : { type: "checkpoint-tail", baseSequence: input.initialSequence };
}

/** Mechanically replay a contiguous retained tail into a hash-verified snapshot. */
export function replayCheckpoint(
  baseSnapshot: GameSnapshot,
  retainedActions: readonly OrderedAction[],
): GameSnapshot {
  let state = loadSnapshot(baseSnapshot);
  let expectedSequence = baseSnapshot.sequence + 1;
  for (const action of retainedActions) {
    if (action.sequence <= baseSnapshot.sequence) continue;
    if (action.sequence !== expectedSequence) {
      throw new Error(
        `Checkpoint replay is not contiguous: expected ${expectedSequence}, received ${action.sequence}`,
      );
    }
    state = applyOrdered(state, action).state;
    expectedSequence += 1;
  }
  return snapshot(state);
}

/** Hash-verified save transformed into the immutable sequence-zero resume base. */
export function resumeBaseFromSave(saved: GameSnapshot): GameSnapshot {
  const state = loadSnapshot(saved);
  return snapshot({ ...state, sequence: 0 });
}

/** Canonical ghost cleanup order is independent of object insertion order. */
export function savedPlayerIdsToRemove(state: CanonicalGameState): string[] {
  return Object.keys(state.players).sort((left, right) => left.localeCompare(right));
}

export interface ScheduledTimerPlan { timerId: string; delayMs: number; }

/** Resume restarts a scheduled timer's full canonical delay exactly once. */
export function scheduledTimersToArm(state: CanonicalGameState): ScheduledTimerPlan[] {
  return Object.values(state.timers ?? {})
    .filter((timer) => timer.status === "scheduled")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((timer) => ({ timerId: timer.id, delayMs: Math.max(1, Math.ceil(timer.delay * 1_000)) }));
}

/** Oldest connected player in durable row order becomes host; otherwise keep the current host. */
export function nextHost(
  playersInJoinOrder: readonly string[],
  connectedPlayerIds: readonly string[],
  currentHost: string | null = null,
): string | null {
  const connected = new Set(connectedPlayerIds);
  return playersInJoinOrder.find((playerId) => connected.has(playerId)) ?? currentHost;
}

/** True when a bootstrap/checkpoint base still connects to the retained tail. */
export function checkpointBaseConnects(
  baseSequence: number,
  state: RoomCoreState,
): boolean {
  return baseSequence >= retentionFloor(state) - 1 && baseSequence <= state.lastSequence;
}

export function assertCheckpointConnectsToTail(
  checkpointSequence: number,
  state: RoomCoreState,
): void {
  const floor = retentionFloor(state);
  if (checkpointSequence < floor - 1 || checkpointSequence > state.lastSequence) {
    throw new Error(
      `Checkpoint sequence ${checkpointSequence} does not connect to retained window ${floor}-${state.lastSequence}`,
    );
  }
}

/** Prefer the initial snapshot while it connects; require a checkpoint only after retention advances. */
export function roomBootstrapFromSnapshots(
  core: RoomCore,
  initialSnapshot: GameSnapshot,
  checkpointSnapshot: GameSnapshot | null,
  players: PlayerInfo[],
  options?: {
    scripted: true;
    /** Complete stored log after the initial or last confirmed checkpoint. */
    fullActions: readonly OrderedAction[];
  },
): readonly ServerMessage[] {
  const initialReplay = core.resumeAfter(initialSnapshot.sequence);
  if (initialReplay.type === "resume") {
    return roomBootstrapMessages(initialSnapshot, players, initialReplay.message.actions);
  }
  if (initialReplay.type === "invalid_sequence") {
    throw new Error("Initial snapshot sequence is ahead of the room sequence");
  }
  if (options?.scripted === true) {
    const base = checkpointSnapshot ?? initialSnapshot;
    loadSnapshot(base);
    if (base.releaseId !== initialSnapshot.releaseId) {
      throw new Error("Room checkpoint release does not match the initial snapshot");
    }
    const actions = contiguousActionsAfter(base.sequence, core.state.lastSequence, options.fullActions);
    return roomBootstrapMessages(base, players, actions);
  }
  if (checkpointSnapshot === null) {
    throw new Error("Room action window requires a checkpoint snapshot");
  }
  loadSnapshot(checkpointSnapshot);
  if (checkpointSnapshot.releaseId !== initialSnapshot.releaseId) {
    throw new Error("Room checkpoint release does not match the initial snapshot");
  }
  assertCheckpointConnectsToTail(checkpointSnapshot.sequence, core.state);
  const checkpointReplay = core.resumeAfter(checkpointSnapshot.sequence);
  if (checkpointReplay.type !== "resume") {
    throw new Error("Room checkpoint does not connect to the retained action tail");
  }
  return roomBootstrapMessages(
    checkpointSnapshot,
    players,
    checkpointReplay.message.actions,
  );
}

function contiguousActionsAfter(
  baseSequence: number,
  lastSequence: number,
  actions: readonly OrderedAction[],
): readonly OrderedAction[] {
  const later = actions.filter((action) => action.sequence > baseSequence);
  let expected = baseSequence + 1;
  for (const action of later) {
    if (action.sequence !== expected) {
      throw new ScriptedBootstrapUnavailableError(
        `Scripted bootstrap log is not contiguous: expected ${expected}, received ${action.sequence}`,
      );
    }
    expected += 1;
  }
  if (expected !== lastSequence + 1) {
    throw new ScriptedBootstrapUnavailableError(
      `Scripted bootstrap log ended at ${expected - 1}, expected ${lastSequence}`,
    );
  }
  return later;
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
