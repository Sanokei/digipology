import { canonicalStringify } from "digipology-canonical-json";
import {
  applyOrderedWithScripts,
  builtInActions,
  loadSnapshot,
  snapshot,
  type ActionActor,
  type ApplyOrderedResult,
  type CanonicalGameState,
  type JsonValue,
  type OrderedActionInput,
} from "digipology-kernel";
import {
  createCreatorScriptRuntime,
  scriptsFromReleaseFiles,
  type CreatorScriptRuntime,
} from "digipology-lua";
import type { ReleaseBundleDto } from "digipology-protocol/http";

import { prevalidateRelease } from "../../releaseValidation";
import { rebuildDraftIntegrity } from "../state/bundle";
import type { EditorDraft } from "../state/types";

export const PLAYTEST_PLAYER_ID = "playtest-player";
export const PLAYTEST_SEAT_ID = "playtest-seat";
export const PLAYTEST_INSTRUCTION_BUDGET = 50_000;
export const PLAYTEST_MEMORY_BUDGET_BYTES = 512 * 1024;

export const PLAYTEST_INTERACTION_ACTIONS = new Set([
  "entity.grab", "entity.drop", "entity.flip", "die.roll", "button.press",
  "deck.shuffle", "deck.draw_to_container", "counter.set", "counter.add",
  "entity.set_locked", "stack.remove_top", "prompt.respond",
]);
const REGISTERED_ACTIONS = new Set(builtInActions.map((definition) => definition.type));

export interface PlaytestLog {
  readonly level: "info" | "warning" | "error";
  readonly message: string;
}

export function compileDraftForPlaytest(draft: EditorDraft): ReleaseBundleDto {
  const candidate = structuredClone(draft);
  rebuildDraftIntegrity(candidate);
  const result = prevalidateRelease(canonicalStringify(candidate.bundle), candidate.minPlayers, candidate.maxPlayers);
  if (result.bundle === null) {
    const failed = result.report.find((item) => !item.ok);
    throw new TypeError(failed?.detail ?? "Draft could not be assembled for playtest.");
  }
  return structuredClone(result.bundle);
}

export class PlaytestRuntime {
  private readonly runtime: CreatorScriptRuntime;
  private readonly onLog: (entry: PlaytestLog) => void;
  private state: CanonicalGameState;
  private tickNumber = 0;
  private readonly dueTimers = new Map<string, number>();
  private closed = false;

  private constructor(
    bundle: ReleaseBundleDto,
    runtime: CreatorScriptRuntime,
    onLog: (entry: PlaytestLog) => void,
  ) {
    this.state = loadSnapshot(bundle.initialSnapshot as never);
    this.runtime = runtime;
    this.onLog = onLog;
  }

  static async create(bundle: ReleaseBundleDto, onLog: (entry: PlaytestLog) => void): Promise<PlaytestRuntime> {
    const entityRefs = Object.fromEntries(Object.keys(
      (bundle.initialSnapshot.state as CanonicalGameState).entities,
    ).sort().map((id) => [id, id]));
    const runtime = new PlaytestRuntime(bundle, await createCreatorScriptRuntime({
      scripts: scriptsFromReleaseFiles(bundle.files),
      refs: { ...entityRefs, ...(bundle.refs ?? {}) },
      definitions: bundle.definitions ?? {},
      instructionBudget: PLAYTEST_INSTRUCTION_BUDGET,
      memoryBudgetBytes: PLAYTEST_MEMORY_BUDGET_BYTES,
    }), onLog);
    await runtime.boot();
    return runtime;
  }

  getState(): CanonicalGameState { return this.state; }
  getSnapshot() { return snapshot(this.state); }

  async dispatchInteraction(type: string, payload: JsonValue): Promise<void> {
    if (!PLAYTEST_INTERACTION_ACTIONS.has(type)) throw new TypeError(`Playtest interaction is not registered: ${type}`);
    await this.apply(type, payload, { type: "player", playerId: PLAYTEST_PLAYER_ID });
  }

  async tick(): Promise<void> {
    this.assertOpen();
    this.tickNumber += 1;
    this.onLog({ level: "info", message: `Kernel tick ${this.tickNumber}.` });
    const due = [...this.dueTimers.entries()]
      .filter(([, dueAt]) => dueAt <= this.tickNumber)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    for (const [timerId] of due) {
      this.dueTimers.delete(timerId);
      await this.apply("system.timer_fire", { timerId }, { type: "system" });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dueTimers.clear();
    this.runtime.close();
  }

  private async boot(): Promise<void> {
    await this.apply("system.game_start", { settings: this.state.settings }, { type: "system" });
    if (Object.keys(this.state.players).length === 0) {
      await this.apply("system.player_joined", { playerId: PLAYTEST_PLAYER_ID, name: "Playtester" }, { type: "system" });
      await this.apply("system.seat_assign", { playerId: PLAYTEST_PLAYER_ID, seatId: PLAYTEST_SEAT_ID }, { type: "system" });
    }
  }

  private async apply(type: string, payload: JsonValue, actor: ActionActor): Promise<boolean> {
    this.assertOpen();
    if (!REGISTERED_ACTIONS.has(type)) {
      this.onLog({ level: "warning", message: `Rejected unregistered script action ${type}.` });
      return false;
    }
    const ordered: OrderedActionInput = {
      sequence: this.state.sequence + 1,
      actionId: `playtest-${this.state.sequence + 1}`,
      actor,
      action: { type, payload },
    };
    const result = await applyOrderedWithScripts(this.state, ordered, { runtime: this.runtime });
    this.state = result.state;
    this.recordEvents(result);
    if (result.rejection !== undefined) {
      this.onLog({ level: "warning", message: `Rejected ${type}: ${result.rejection.reason}` });
      return false;
    }
    this.onLog({ level: "info", message: `Applied ${type} at sequence ${this.state.sequence}.` });
    return true;
  }

  private recordEvents(result: ApplyOrderedResult): void {
    for (const event of result.events) {
      this.onLog({
        level: event.type === "script.error" ? "error" : "info",
        message: event.type === "script.error"
          ? `${String(event.data.script)} ${String(event.data.function)}: ${String(event.data.message)}`
          : `Event ${event.type}.`,
      });
      if (event.type === "timer.registered" && typeof event.data.timerId === "string" && typeof event.data.delay === "number") {
        this.dueTimers.set(event.data.timerId, this.tickNumber + Math.max(1, Math.ceil(event.data.delay)));
      } else if ((event.type === "timer.canceled" || event.type === "timer.fired") && typeof event.data.timerId === "string") {
        this.dueTimers.delete(event.data.timerId);
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Playtest runtime is stopped.");
  }
}
