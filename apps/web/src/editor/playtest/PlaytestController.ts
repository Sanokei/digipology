import { useSyncExternalStore } from "react";
import type { JsonValue } from "digipology-kernel";

import { KernelStore } from "../../state/kernelStore";
import type { EditorDraft } from "../state";
import { compileDraftForPlaytest, PlaytestRuntime, type PlaytestLog } from "./runtime";

export interface PlaytestControllerSnapshot {
  readonly status: "stopped" | "starting" | "playing";
  readonly logs: readonly (PlaytestLog & { id: number })[];
  readonly tick: number;
}

export class PlaytestController {
  readonly projection = new KernelStore();
  private runtime: PlaytestRuntime | null = null;
  private listeners = new Set<() => void>();
  private logId = 0;
  private task: Promise<void> = Promise.resolve();
  private current: PlaytestControllerSnapshot = { status: "stopped", logs: [], tick: 0 };

  getSnapshot = (): PlaytestControllerSnapshot => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(draft: EditorDraft): Promise<void> {
    if (this.current.status !== "stopped") return;
    this.publish({ ...this.current, status: "starting", logs: [], tick: 0 });
    try {
      const bundle = compileDraftForPlaytest(draft);
      this.projection.loadRelease(bundle);
      this.runtime = await PlaytestRuntime.create(bundle, (entry) => this.appendLog(entry));
      this.projection.replaceSnapshot(this.runtime.getSnapshot());
      this.appendLog({ level: "info", message: "Playtest started in an isolated in-tab runtime." });
      this.publish({ ...this.current, status: "playing" });
    } catch (error) {
      this.runtime?.close();
      this.runtime = null;
      this.appendLog({ level: "error", message: error instanceof Error ? error.message : String(error) });
      this.publish({ ...this.current, status: "stopped" });
    }
  }

  stop(): void {
    this.runtime?.close();
    this.runtime = null;
    this.task = Promise.resolve();
    this.appendLog({ level: "info", message: "Playtest stopped; runtime state discarded." });
    this.publish({ ...this.current, status: "stopped", tick: 0 });
  }

  tick(): void {
    if (this.runtime === null) return;
    this.enqueue(async (runtime) => {
      await runtime.tick();
      this.projection.replaceSnapshot(runtime.getSnapshot());
      this.publish({ ...this.current, tick: this.current.tick + 1 });
    });
  }

  sendAction(action: { type: string; payload: unknown }): string | null {
    if (this.runtime === null) return null;
    const requestId = `playtest-request-${this.logId}`;
    this.enqueue(async (runtime) => {
      await runtime.dispatchInteraction(action.type, action.payload as JsonValue);
      this.projection.replaceSnapshot(runtime.getSnapshot());
    });
    return requestId;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private enqueue(operation: (runtime: PlaytestRuntime) => Promise<void>): void {
    const runtime = this.runtime;
    if (runtime === null) return;
    this.task = this.task.then(() => operation(runtime)).catch((error) => {
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
