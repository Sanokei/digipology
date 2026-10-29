import { useSyncExternalStore } from "react";
import type { JsonValue } from "digipology-kernel";
import type { PlayerInfo } from "digipology-protocol";

import { KernelStore } from "../../state/kernelStore";
import type { EditorDraft } from "../state";
import { compileDraftForPlaytest, PlaytestRuntime, PLAYTEST_PLAYER_ID, type PlaytestLog, type PlaytestOptions } from "./runtime";

export interface PlaytestControllerSnapshot {
  readonly status: "stopped" | "starting" | "playing";
  readonly logs: readonly (PlaytestLog & { id: number })[];
  readonly tick: number;
  readonly playerId: string;
  readonly error: string | null;
}

export class PlaytestController {
  readonly projection = new KernelStore();
  private runtime: PlaytestRuntime | null = null;
  private listeners = new Set<() => void>();
  private logId = 0;
  private task: Promise<void> = Promise.resolve();
  private generation = 0;
  private current: PlaytestControllerSnapshot = { status: "stopped", logs: [], tick: 0, playerId: PLAYTEST_PLAYER_ID, error: null };

  getSnapshot = (): PlaytestControllerSnapshot => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(draft: EditorDraft, options: PlaytestOptions = {}): Promise<void> {
    if (this.current.status !== "stopped") return;
    const generation = ++this.generation;
    this.publish({ ...this.current, status: "starting", logs: [], tick: 0, error: null });
    try {
      const bundle = compileDraftForPlaytest(draft);
      this.projection.loadRelease(bundle);
      const runtime = await PlaytestRuntime.create(bundle, (entry) => { if (generation === this.generation) this.appendLog(entry); }, options);
      if (generation !== this.generation) { runtime.close(); return; }
      this.runtime = runtime;
      this.projection.replaceSnapshot(runtime.getSnapshot(), runtime.getEvents());
      const state = runtime.getState();
      const players: PlayerInfo[] = Object.keys(state.players).sort().map((id) => ({
        playerId: id, displayName: String(state.players[id]!.name ?? id),
        seatId: Object.keys(state.seats).sort().find((seat) => state.seats[seat]?.playerId === id) ?? null, connected: true,
      }));
      this.projection.updatePlayers(players);
      this.appendLog({ level: "info", message: "Playtest started in an isolated in-tab runtime." });
      this.publish({ ...this.current, status: "playing", playerId: players[0]?.playerId ?? PLAYTEST_PLAYER_ID });
    } catch (error) {
      if (generation !== this.generation) return;
      this.runtime?.close();
      this.runtime = null;
      this.appendLog({ level: "error", message: error instanceof Error ? error.message : String(error) });
      this.publish({ ...this.current, status: "stopped", error: error instanceof Error ? error.message : String(error) });
    }
  }

  stop(): void {
    this.generation += 1;
    this.runtime?.close();
    this.runtime = null;
    this.task = Promise.resolve();
    this.appendLog({ level: "info", message: "Playtest stopped; runtime state discarded." });
    this.publish({ ...this.current, status: "stopped", tick: 0 });
  }

  tick(): void {
    if (this.runtime === null) return;
    this.enqueue(async (runtime) => runtime.tick(), true);
  }

  selectPlayer(playerId: string): void {
    if (this.runtime && Object.hasOwn(this.runtime.getState().players, playerId)) this.publish({ ...this.current, playerId });
  }

  sendAction(action: { type: string; payload: unknown }): string | null {
    if (this.runtime === null) return null;
    const requestId = `playtest-request-${this.logId}`;
    const playerId = this.current.playerId;
    this.enqueue(async (runtime) => {
      await runtime.dispatchInteraction(action.type, action.payload as JsonValue, playerId);
    });
    return requestId;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.projection.dispose();
  }

  private enqueue(operation: (runtime: PlaytestRuntime) => Promise<void>, tick = false): void {
    const runtime = this.runtime;
    if (runtime === null) return;
    const generation = this.generation;
    this.task = this.task.then(async () => {
      if (this.runtime !== runtime || generation !== this.generation) return;
      await operation(runtime);
      if (this.runtime !== runtime || generation !== this.generation) return;
      this.projection.replaceSnapshot(runtime.getSnapshot(), runtime.getEvents());
      if (tick) this.publish({ ...this.current, tick: this.current.tick + 1 });
    }).catch((error) => {
      if (generation !== this.generation) return;
      this.appendLog({ level: "error", message: error instanceof Error ? error.message : String(error) });
    });
  }

  private appendLog(entry: PlaytestLog): void {
    this.current = { ...this.current, logs: [...this.current.logs, { ...entry, id: this.logId++ }].slice(-500) };
    this.notify();
  }

  private publish(snapshot: PlaytestControllerSnapshot): void {
    this.current = snapshot;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function usePlaytestSnapshot(controller: PlaytestController): PlaytestControllerSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
