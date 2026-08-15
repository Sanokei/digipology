import {
  applyOrdered,
  applyOrderedWithScripts as applyOrderedWithCreatorScripts,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type KernelEvent,
  type OrderedActionInput,
  type ApplyOrderedResult,
} from "digipology-kernel";
import {
  createCreatorScriptRuntime,
  scriptsFromReleaseFiles,
  type CreatorScriptRuntime,
} from "digipology-lua";
import type { OrderedAction, PlayerInfo, ResumeMessage, RoomEndedMessage } from "digipology-protocol";

import type { ReleaseBundleDto } from "digipology-protocol/http";

export interface PredictionAction {
  type: string;
  payload: unknown;
}

export interface PendingPrediction {
  requestId: string;
  action: PredictionAction;
  predictedAtSequence: number;
}

export interface PredictionCorrection {
  id: number;
  entityId: string | null;
  message: string;
}

export interface KernelStoreSnapshot {
  /** Canonical state advanced only by snapshots and ordered actions. */
  state: CanonicalGameState | null;
  /** Display-only state rebuilt from confirmed state plus the prediction ledger. */
  displayedState: CanonicalGameState | null;
  events: KernelEvent[];
  players: PlayerInfo[];
  pendingRequestIds: ReadonlySet<string>;
  predictionLedger: readonly PendingPrediction[];
  correction: PredictionCorrection | null;
  endedReason: RoomEndedMessage["reason"] | null;
  /** Hash of confirmed state only. */
  stateHash: string | null;
  diagnostic: string | null;
  definitions: Readonly<Record<string, { label?: string; color?: string }>>;
  gameTitle: string | null;
}

export type ApplyStreamResult = { ok: true } | { ok: false; expected: number; actual: number };

const PREDICTED_ACTION_TYPES = new Set(["entity.grab", "entity.drop", "entity.flip"]);

export function isPredictableAction(action: PredictionAction): boolean {
  return PREDICTED_ACTION_TYPES.has(action.type);
}

function bundleSnapshot(bundle: ReleaseBundleDto): GameSnapshot {
  return bundle.initialSnapshot as unknown as GameSnapshot;
}

function toKernelAction(message: OrderedAction): OrderedActionInput<unknown> {
  return {
    sequence: message.sequence,
    actionId: message.actionId,
    actor: message.actor,
    action: message.action,
  };
}

function predictionKernelAction(
  state: CanonicalGameState,
  prediction: PendingPrediction,
  playerId: string,
): OrderedActionInput<unknown> {
  return {
    sequence: state.sequence + 1,
    actionId: `prediction:${prediction.requestId}`,
    actor: { type: "player", playerId },
    action: prediction.action,
  };
}

function actionEntityId(action: PredictionAction): string | null {
  if (typeof action.payload !== "object" || action.payload === null || Array.isArray(action.payload)) return null;
  const entityId = (action.payload as Record<string, unknown>).entityId;
  return typeof entityId === "string" ? entityId : null;
}

export class KernelStore {
  private current: KernelStoreSnapshot = {
    state: null, displayedState: null, events: [], players: [], pendingRequestIds: new Set(),
    predictionLedger: [], correction: null, endedReason: null, stateHash: null,
    diagnostic: null, definitions: {}, gameTitle: null,
  };
  private readonly listeners = new Set<() => void>();
  private initialSnapshot: GameSnapshot | null = null;
  private predictionPlayerId: string | null = null;
  private correctionId = 0;
  private scriptRuntime: CreatorScriptRuntime | null = null;

  getSnapshot = (): KernelStoreSnapshot => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(next: KernelStoreSnapshot): void {
    this.current = next;
    for (const listener of this.listeners) listener();
  }

  loadRelease(bundle: ReleaseBundleDto): void {
    const initial = bundleSnapshot(bundle);
    this.initialSnapshot = initial;
    this.replaceSnapshot(initial);
    this.publish({
      ...this.current,
      definitions: bundle.definitions ?? {},
      gameTitle: bundle.title ?? null,
    });
  }

  async loadScriptRuntime(bundle: ReleaseBundleDto): Promise<void> {
    this.scriptRuntime?.close();
    this.scriptRuntime = null;
    const files = Array.isArray(bundle.files) ? bundle.files : [];
    if (!files.some((file) => file.path.startsWith("scripts/") && file.path.endsWith(".lua"))) return;
    const initial = loadSnapshot(bundleSnapshot(bundle));
    if (!Object.values(initial.entities).some((entity) => entity.components.script !== undefined)) return;
    const entityRefs = Object.fromEntries(Object.keys(initial.entities).sort().map((id) => [id, id]));
    this.scriptRuntime = await createCreatorScriptRuntime({
      scripts: scriptsFromReleaseFiles(files),
      refs: { ...entityRefs, ...(bundle.refs ?? {}) },
      definitions: bundle.definitions ?? {},
      instructionBudget: 50_000,
      memoryBudgetBytes: 512 * 1024,
    });
  }

  hasScriptRuntime(): boolean {
    return this.scriptRuntime !== null;
  }

  dispose(): void {
    this.scriptRuntime?.close();
    this.scriptRuntime = null;
    this.listeners.clear();
  }

  resetToRelease(): void {
    if (this.initialSnapshot === null) throw new Error("Release is not loaded");
    this.replaceSnapshot(this.initialSnapshot);
  }

  replaceSnapshot(value: GameSnapshot): void {
    const state = loadSnapshot(value);
    this.publish({
      ...this.current,
      state,
      displayedState: state,
      events: [],
      pendingRequestIds: new Set(),
      predictionLedger: [],
      correction: null,
      stateHash: snapshot(state).stateHash,
      diagnostic: `Loaded snapshot at sequence ${state.sequence}`,
    });
  }

  bootstrap(sequence: number, players: PlayerInfo[], value?: unknown): ApplyStreamResult {
    if (value !== undefined) this.replaceSnapshot(value as GameSnapshot);
    const actual = this.current.state?.sequence ?? -1;
    this.publish({ ...this.current, players });
    if (actual !== sequence) return this.gap(actual + 1, sequence);
    return { ok: true };
  }

  /**
   * Applies an ordered action to confirmed state, then rebuilds displayed state
   * by replaying every still-valid local prediction in submission order.
   */
  applyOrdered(message: OrderedAction): ApplyStreamResult {
    const confirmed = this.current.state;
    if (confirmed === null) return this.gap(0, message.sequence);
    const expected = confirmed.sequence + 1;
    if (message.sequence !== expected) return this.gap(expected, message.sequence);

    const confirmedResult = applyOrdered(confirmed, toKernelAction(message));
    return this.commitOrdered(message, confirmedResult);
  }

  async applyOrderedWithScriptRuntime(message: OrderedAction): Promise<ApplyStreamResult> {
    const runtime = this.scriptRuntime;
    if (runtime === null) return this.applyOrdered(message);
    const confirmed = this.current.state;
    if (confirmed === null) return this.gap(0, message.sequence);
    const expected = confirmed.sequence + 1;
    if (message.sequence !== expected) return this.gap(expected, message.sequence);
    const confirmedResult = await applyOrderedWithCreatorScripts(
      confirmed,
      toKernelAction(message),
      { runtime },
    );
    return this.commitOrdered(message, confirmedResult);
  }

  private commitOrdered(
    message: OrderedAction,
    confirmedResult: ApplyOrderedResult,
  ): ApplyStreamResult {
    const pendingRequestIds = new Set(this.current.pendingRequestIds);
    if (message.requestId !== undefined) pendingRequestIds.delete(message.requestId);

    const matchedPrediction = message.requestId === undefined
      ? undefined
      : this.current.predictionLedger.find((prediction) => prediction.requestId === message.requestId);
    const candidates = message.requestId === undefined
      ? this.current.predictionLedger
      : this.current.predictionLedger.filter((prediction) => prediction.requestId !== message.requestId);
    const replay = this.replayPredictions(confirmedResult.state, candidates);
    let correction = replay.correction;
    if (correction === null && matchedPrediction !== undefined && confirmedResult.rejection !== undefined) {
      correction = this.makeCorrection(confirmedResult.state, matchedPrediction);
    }

    const replayHash = snapshot(replay.state).stateHash;
    const previousDisplayed = this.current.displayedState;
    const displayedState = previousDisplayed !== null && snapshot(previousDisplayed).stateHash === replayHash
      ? previousDisplayed
      : replay.state;
    const confirmedHash = snapshot(confirmedResult.state).stateHash;
    this.publish({
      ...this.current,
      state: confirmedResult.state,
      displayedState,
      events: confirmedResult.events,
      pendingRequestIds,
      predictionLedger: replay.ledger,
      correction: correction ?? this.current.correction,
      stateHash: confirmedHash,
      diagnostic: confirmedResult.rejection === undefined
        ? `Applied sequence ${message.sequence}; hash ${confirmedHash}`
        : `Sequence ${message.sequence} rejected by kernel: ${confirmedResult.rejection.reason}`,
    });
    return { ok: true };
  }

  applyResume(message: ResumeMessage): ApplyStreamResult {
    const expected = (this.current.state?.sequence ?? -1) + 1;
    if (message.fromSequence !== expected) return this.gap(expected, message.fromSequence);
    for (const action of message.actions) {
      const result = this.applyOrdered(action);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  /**
   * Validates and applies a display-only prediction. False means the caller
   * must not send the request because the local kernel rejected it.
   */
  predictLocal(prediction: PendingPrediction, playerId: string): boolean {
    const displayed = this.current.displayedState;
    if (displayed === null || !isPredictableAction(prediction.action)) return false;
    if (this.predictionPlayerId !== null && this.predictionPlayerId !== playerId) {
      throw new Error("A KernelStore cannot predict for multiple local players");
    }
    this.predictionPlayerId = playerId;
    const result = applyOrdered(displayed, predictionKernelAction(displayed, prediction, playerId));
    if (result.rejection !== undefined) {
      const correction = this.makeCorrection(displayed, prediction);
      this.publish({
        ...this.current,
        correction,
        diagnostic: `Local ${prediction.action.type} was not applied`,
      });
      return false;
    }

    const pendingRequestIds = new Set(this.current.pendingRequestIds);
    pendingRequestIds.add(prediction.requestId);
    this.publish({
      ...this.current,
      displayedState: result.state,
      pendingRequestIds,
      predictionLedger: [...this.current.predictionLedger, prediction],
      correction: null,
    });
    return true;
  }

  trackRequest(requestId: string): void {
    const pending = new Set(this.current.pendingRequestIds);
    pending.add(requestId);
    this.publish({ ...this.current, pendingRequestIds: pending });
  }

  /**
   * Drops requests tied to a dead transport. They are never resent, so keeping
   * their optimistic effects would leave displayed state ahead of the server.
   */
  dropPendingRequests(requestIds: ReadonlySet<string> = this.current.pendingRequestIds): void {
    if (requestIds.size === 0) return;
    const dropped = this.current.predictionLedger.filter((prediction) => requestIds.has(prediction.requestId));
    const candidates = this.current.predictionLedger.filter((prediction) => !requestIds.has(prediction.requestId));
    const confirmed = this.current.state;
    const replay = confirmed === null
      ? { state: null, ledger: [] as PendingPrediction[], correction: null as PredictionCorrection | null }
      : this.replayPredictions(confirmed, candidates);
    const previousDisplayed = this.current.displayedState;
    const visiblyRolledBack = dropped.length > 0 && previousDisplayed !== null && replay.state !== null &&
      snapshot(previousDisplayed).stateHash !== snapshot(replay.state).stateHash;
    const correction = replay.correction ?? (visiblyRolledBack ? this.makeCorrection(replay.state!, dropped[0]!) : null);
    const pendingRequestIds = new Set(this.current.pendingRequestIds);
    for (const requestId of requestIds) pendingRequestIds.delete(requestId);
    this.publish({
      ...this.current,
      displayedState: replay.state,
      pendingRequestIds,
      predictionLedger: replay.ledger,
      correction: correction ?? this.current.correction,
      diagnostic: `Dropped ${requestIds.size} unconfirmed request${requestIds.size === 1 ? "" : "s"} after connection loss`,
    });
  }

  roomEnded(reason: RoomEndedMessage["reason"]): void {
    this.publish({
      ...this.current,
      displayedState: this.current.state,
      pendingRequestIds: new Set(),
      predictionLedger: [],
      correction: null,
      endedReason: reason,
      diagnostic: `Room ended: ${reason}`,
    });
  }

  clearCorrection(id: number): void {
    if (this.current.correction?.id === id) this.publish({ ...this.current, correction: null });
  }

  setDiagnostic(diagnostic: string): void {
    this.publish({ ...this.current, diagnostic });
  }

  private replayPredictions(
    confirmed: CanonicalGameState,
    predictions: readonly PendingPrediction[],
  ): { state: CanonicalGameState; ledger: PendingPrediction[]; correction: PredictionCorrection | null } {
    const playerId = this.predictionPlayerId;
    if (playerId === null || predictions.length === 0) {
      return { state: confirmed, ledger: [], correction: null };
    }
    let displayed = confirmed;
    const ledger: PendingPrediction[] = [];
    let correction: PredictionCorrection | null = null;
    for (const prediction of predictions) {
      const result = applyOrdered(displayed, predictionKernelAction(displayed, prediction, playerId));
      if (result.rejection !== undefined) {
        correction ??= this.makeCorrection(displayed, prediction);
        continue;
      }
      displayed = result.state;
      ledger.push(prediction);
    }
    return { state: displayed, ledger, correction };
  }

  private makeCorrection(state: CanonicalGameState, prediction: PendingPrediction): PredictionCorrection {
    const entityId = actionEntityId(prediction.action);
    let message = "The table changed before that action could finish.";
    if (entityId !== null) {
      const heldBy = state.entities[entityId]?.components.grabbable?.heldBy;
      if (typeof heldBy === "string" && heldBy !== this.predictionPlayerId) {
        const displayName = this.current.players.find((player) => player.playerId === heldBy)?.displayName ?? heldBy;
        message = `${displayName} is holding this`;
      }
    }
    this.correctionId += 1;
    return { id: this.correctionId, entityId, message };
  }

  private gap(expected: number, actual: number): ApplyStreamResult {
    this.publish({ ...this.current, diagnostic: `Sequence gap: expected ${expected}, received ${actual}` });
    return { ok: false, expected, actual };
  }
}
