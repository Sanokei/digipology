import {
  applyOrdered,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type KernelEvent,
  type OrderedActionInput,
} from "digipology-kernel";
import type { OrderedAction, PlayerInfo, ResumeMessage, RoomEndedMessage } from "digipology-protocol";

import type { ReleaseBundleDto } from "../api/types";

export interface KernelStoreSnapshot {
  state: CanonicalGameState | null;
  events: KernelEvent[];
  players: PlayerInfo[];
  pendingRequestIds: ReadonlySet<string>;
  endedReason: RoomEndedMessage["reason"] | null;
  stateHash: string | null;
  diagnostic: string | null;
  definitions: Readonly<Record<string, { label?: string; color?: string }>>;
  gameTitle: string | null;
}

export type ApplyStreamResult = { ok: true } | { ok: false; expected: number; actual: number };

function bundleSnapshot(bundle: ReleaseBundleDto): GameSnapshot {
  const candidate = bundle.initialSnapshot ?? bundle.snapshot;
  if (candidate === undefined) {
    // TODO: align this adapter with the final release-bundle DTO from the platform worker PR.
    throw new TypeError("Release bundle does not contain an initial snapshot");
  }
  return candidate;
}

function toKernelAction(message: OrderedAction): OrderedActionInput<unknown> {
  return {
    sequence: message.sequence,
    actionId: message.actionId,
    actor: message.actor,
    action: message.action,
  };
}

export class KernelStore {
  private current: KernelStoreSnapshot = {
    state: null, events: [], players: [], pendingRequestIds: new Set(),
    endedReason: null, stateHash: null, diagnostic: null, definitions: {}, gameTitle: null,
  };
  private readonly listeners = new Set<() => void>();
  private initialSnapshot: GameSnapshot | null = null;

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
      gameTitle: bundle.title ?? bundle.game?.title ?? null,
    });
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
      events: [],
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

  applyOrdered(message: OrderedAction): ApplyStreamResult {
    const state = this.current.state;
    if (state === null) return this.gap(0, message.sequence);
    const expected = state.sequence + 1;
    if (message.sequence !== expected) return this.gap(expected, message.sequence);
    const result = applyOrdered(state, toKernelAction(message));
    const pending = new Set(this.current.pendingRequestIds);
    if (message.requestId !== undefined) pending.delete(message.requestId);
    this.publish({
      ...this.current,
      state: result.state,
      events: result.events,
      pendingRequestIds: pending,
      stateHash: snapshot(result.state).stateHash,
      diagnostic: result.rejection === undefined
        ? `Applied sequence ${message.sequence}; hash ${snapshot(result.state).stateHash}`
        : `Sequence ${message.sequence} rejected by kernel: ${result.rejection.reason}`,
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

  trackRequest(requestId: string): void {
    const pending = new Set(this.current.pendingRequestIds);
    pending.add(requestId);
    this.publish({ ...this.current, pendingRequestIds: pending });
  }

  roomEnded(reason: RoomEndedMessage["reason"]): void {
    this.publish({ ...this.current, endedReason: reason, diagnostic: `Room ended: ${reason}` });
  }

  setDiagnostic(diagnostic: string): void {
    this.publish({ ...this.current, diagnostic });
  }

  private gap(expected: number, actual: number): ApplyStreamResult {
    this.publish({ ...this.current, diagnostic: `Sequence gap: expected ${expected}, received ${actual}` });
    return { ok: false, expected, actual };
  }
}
