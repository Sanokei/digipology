import { canonicalStringify } from "digipology-canonical-json";
import {
  applyOrdered,
  builtInActions,
  loadSnapshot,
  snapshot,
  type ActionActor,
  type CanonicalGameState,
  type JsonValue,
  type OrderedActionInput,
} from "digipology-kernel";
import { createSandbox, LuaError, type LuaValue, type Sandbox } from "digipology-lua";
import type { ReleaseBundleDto } from "digipology-protocol/http";

import { prevalidateRelease } from "../../releaseValidation";
import { rebuildDraftIntegrity } from "../state/bundle";
import type { EditorDraft } from "../state/types";

export const PLAYTEST_PLAYER_ID = "playtest-player";
export const PLAYTEST_SEAT_ID = "playtest-seat";
export const PLAYTEST_INSTRUCTION_BUDGET = 50_000;
export const PLAYTEST_MEMORY_BUDGET_BYTES = 512 * 1024;

const INTERACTION_ACTIONS = new Set([
  "entity.grab", "entity.drop", "entity.flip", "die.roll", "deck.shuffle",
  "deck.draw_to_container", "counter.set", "counter.add",
]);
const REGISTERED_ACTIONS = new Set(builtInActions.map((definition) => definition.type));

export interface PlaytestLog {
  readonly level: "info" | "warning" | "error";
  readonly message: string;
}

export interface ScriptAction {
  readonly type: string;
  readonly payload: JsonValue;
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

function isRecord(value: LuaValue): value is { [key: string]: LuaValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function returnedActions(value: LuaValue): ScriptAction[] {
  if (value === null) return [];
  if (isRecord(value) && Object.keys(value).length === 0) return [];
  if (!Array.isArray(value)) throw new TypeError("Lua callback must return an action array or nil");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.type !== "string" || !("payload" in item)) {
      throw new TypeError("Lua callback returned an invalid action descriptor");
    }
    return { type: item.type, payload: item.payload as JsonValue };
  });
}

const HOST_PRELUDE = `
local function entity_proxy(id)
  return {
    id = id,
    flip = function(self) return emit_action("entity.flip", { entityId = id }) end,
    roll = function(self) return emit_action("die.roll", { entityId = id }) end,
    shuffle = function(self) return emit_action("deck.shuffle", { deckId = id }) end,
    draw_to = function(self, target, count) return emit_action("deck.draw_to_container", { deckId = id, target = target.id, count = count or 1 }) end,
    set = function(self, value) return emit_action("counter.set", { entityId = id, value = value }) end,
    add = function(self, amount) return emit_action("counter.add", { entityId = id, amount = amount }) end,
    subtract = function(self, amount) return emit_action("counter.add", { entityId = id, amount = -amount }) end,
  }
end
refs = {}
for _, id in ipairs(entity_ids) do refs[id] = entity_proxy(id) end
players = {
  list = function(self)
    local result = {}
    for _, player in ipairs(player_specs) do
      local proxy = { id = player.playerId, name = player.name, seat = { id = player.seatId } }
      if player.handId then proxy.hand = entity_proxy(player.handId) end
      table.insert(result, proxy)
    end
    return result
  end,
}
timer = {
  after = function(self, delay, callback_name) return schedule_timer(delay, callback_name) end,
  cancel = function(self, timer_id) return cancel_timer(timer_id) end,
}
ui = {
  prompt = function(self, player, schema) return prompt_event("prompt", player.id, schema) end,
  confirm = function(self, player, schema) return prompt_event("confirm", player.id, schema) end,
  number_prompt = function(self, player, schema) return prompt_event("number", player.id, schema) end,
}
self = entity_proxy(context_entity_id or "")
props = {}
`;

export class PlaytestRuntime {
  private readonly sandbox: Sandbox;
  private readonly scripts: ReadonlyArray<{ path: string; source: string }>;
  private readonly onLog: (entry: PlaytestLog) => void;
  private state: CanonicalGameState;
  private tickNumber = 0;
  private timers: Array<{ id: string; due: number; callback: string }> = [];
  private timerId = 0;
  private closed = false;

  private constructor(bundle: ReleaseBundleDto, sandbox: Sandbox, onLog: (entry: PlaytestLog) => void) {
    this.state = loadSnapshot(bundle.initialSnapshot as never);
    this.sandbox = sandbox;
    this.onLog = onLog;
    this.scripts = bundle.files.filter((file) => file.path.startsWith("scripts/") && file.path.endsWith(".lua"))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ path: file.path, source: file.content }));
  }

  static async create(bundle: ReleaseBundleDto, onLog: (entry: PlaytestLog) => void): Promise<PlaytestRuntime> {
    const runtime = new PlaytestRuntime(bundle, await createSandbox({
      instructionBudget: PLAYTEST_INSTRUCTION_BUDGET,
      memoryBudgetBytes: PLAYTEST_MEMORY_BUDGET_BYTES,
    }), onLog);
    await runtime.boot();
    return runtime;
  }

  getState(): CanonicalGameState {
    return this.state;
  }

  getSnapshot() {
    return snapshot(this.state);
  }

  async dispatchInteraction(type: string, payload: JsonValue): Promise<void> {
    if (!INTERACTION_ACTIONS.has(type)) throw new TypeError(`Playtest interaction is not registered: ${type}`);
    const guard = type === "entity.grab" ? "can_grab"
      : type === "entity.drop" ? "can_drop"
        : type === "entity.flip" ? "can_flip"
          : null;
    if (guard !== null) {
      const result = await this.runGuard(guard, typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? String((payload as { entityId?: unknown }).entityId ?? "")
        : "");
      if (!result.allowed) {
        this.apply(type, {} as JsonValue, { type: "player", playerId: PLAYTEST_PLAYER_ID });
        this.onLog({ level: "warning", message: `Guard ${guard} denied ${type}${result.reason === null ? "." : `: ${result.reason}`}` });
        return;
      }
    }
    const callback = type === "entity.grab" ? "on_grab"
      : type === "entity.drop" ? "on_drop"
        : type === "entity.flip" ? "on_flip"
          : type === "die.roll" ? "on_roll"
            : null;
    const result = this.apply(type, payload, { type: "player", playerId: PLAYTEST_PLAYER_ID });
    if (result && callback !== null) {
      const entityId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? String((payload as { entityId?: unknown }).entityId ?? "")
        : "";
      await this.runCallback(callback, entityId);
    }
  }

  async tick(): Promise<void> {
    this.assertOpen();
    this.tickNumber += 1;
    this.onLog({ level: "info", message: `Kernel tick ${this.tickNumber}.` });
    const due = this.timers.filter((timer) => timer.due <= this.tickNumber);
    this.timers = this.timers.filter((timer) => timer.due > this.tickNumber);
    for (const timer of due) {
      this.onLog({ level: "info", message: `Timer fired: ${timer.id} -> ${timer.callback}.` });
      await this.runCallback(timer.callback);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.timers = [];
    this.sandbox.close();
  }

  private async boot(): Promise<void> {
    this.apply("system.game_start", { settings: this.state.settings }, { type: "system" });
    if (Object.keys(this.state.players).length === 0) {
      this.apply("system.player_joined", { playerId: PLAYTEST_PLAYER_ID, name: "Playtester" }, { type: "system" });
      this.apply("system.seat_assign", { playerId: PLAYTEST_PLAYER_ID, seatId: PLAYTEST_SEAT_ID }, { type: "system" });
      await this.runCallback("on_player_join");
    }
    await this.runCallback("on_start");
  }

  private apply(type: string, payload: JsonValue, actor: ActionActor): boolean {
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
    const result = applyOrdered(this.state, ordered);
    this.state = result.state;
    if (result.rejection !== undefined) {
      this.onLog({ level: "warning", message: `Rejected ${type}: ${result.rejection.reason}` });
      return false;
    }
    this.onLog({ level: "info", message: `Applied ${type} at sequence ${this.state.sequence}.` });
    for (const event of result.events) this.onLog({ level: "info", message: `Event ${event.type}.` });
    return true;
  }

  private async runCallback(callback: string, contextEntityId = ""): Promise<void> {
    for (const script of this.scripts) {
      const emitted: ScriptAction[] = [];
      const playerSpecs = Object.keys(this.state.players).sort().map((playerId) => {
        const player = this.state.players[playerId]!;
        const seat = Object.values(this.state.seats).find((candidate) => candidate.playerId === playerId);
        return { playerId, name: player.name ?? playerId, handId: seat?.handId ?? null, seatId: seat?.id ?? null };
      });
      const wrapper = `${HOST_PRELUDE}\nlocal function __load_script()\n${script.source}\nend\nlocal __returned = __load_script()\nif __returned ~= nil then return __returned end\nlocal __callback = _G[callback]\nif __callback == nil then return {} end\nreturn __callback({ player = players:list()[1] }) or {}`;
      try {
        const value = await this.sandbox.run(wrapper, {
          callback,
          state: this.state.scriptState,
          settings: this.state.settings,
          entity_ids: Object.keys(this.state.entities).sort(),
          player_specs: playerSpecs,
          context_entity_id: contextEntityId,
          seated_players: playerSpecs.map((player) => ({ playerId: player.playerId, handId: player.handId })),
          cards_per_player: this.state.settings.cardsPerPlayer ?? 0,
          deck_id: Object.keys(this.state.entities).sort().find((id) => this.state.entities[id]?.components.deck !== undefined) ?? "deck",
          emit_action: (type: LuaValue, payload: LuaValue) => {
            if (typeof type !== "string") throw new TypeError("Script action type must be a string");
            emitted.push({ type, payload: payload as JsonValue });
            return null;
          },
          schedule_timer: (delay: LuaValue, name: LuaValue) => {
            if (typeof delay !== "number" || typeof name !== "string") throw new TypeError("Invalid timer");
            const id = `timer-${this.timerId++}`;
            this.timers.push({ id, due: this.tickNumber + Math.max(1, Math.ceil(delay)), callback: name });
            return id;
          },
          cancel_timer: (id: LuaValue) => {
            if (typeof id === "string") this.timers = this.timers.filter((timer) => timer.id !== id);
            return null;
          },
          prompt_event: (kind: LuaValue, playerId: LuaValue) => {
            this.onLog({ level: "info", message: `Prompt ${String(kind)} for ${String(playerId)}.` });
            return null;
          },
          print: (...values: LuaValue[]) => {
            this.onLog({ level: "info", message: values.map(String).join(" ") });
            return null;
          },
        });
        for (const action of [...returnedActions(value), ...emitted]) {
          this.apply(action.type, action.payload, { type: "script", scriptId: script.path });
        }
      } catch (error) {
        const detail = error instanceof LuaError ? `${error.kind}${error.line === undefined ? "" : ` line ${error.line}`}: ${error.message}` : String(error);
        this.onLog({ level: "error", message: `${script.path} ${callback}: ${detail}` });
      }
    }
  }

  private async runGuard(guard: string, entityId: string): Promise<{ allowed: boolean; reason: string | null }> {
    for (const script of this.scripts) {
      let attemptedMutation = false;
      const playerSpecs = Object.keys(this.state.players).sort().map((playerId) => {
        const player = this.state.players[playerId]!;
        const seat = Object.values(this.state.seats).find((candidate) => candidate.playerId === playerId);
        return { playerId, name: player.name ?? playerId, handId: seat?.handId ?? null, seatId: seat?.id ?? null };
      });
      const wrapper = `${HOST_PRELUDE}\nlocal function __load_script()\n${script.source}\nend\n__load_script()\nlocal __guard = _G[callback]\nif __guard == nil then return { true } end\nreturn { __guard({ player = players:list()[1] }) }`;
      try {
        const value = await this.sandbox.run(wrapper, {
          callback: guard,
          state: this.state.scriptState,
          settings: this.state.settings,
          entity_ids: Object.keys(this.state.entities).sort(),
          player_specs: playerSpecs,
          context_entity_id: entityId,
          emit_action: () => { attemptedMutation = true; return null; },
          schedule_timer: () => { attemptedMutation = true; return "guard-timer"; },
          cancel_timer: () => { attemptedMutation = true; return null; },
          prompt_event: () => { attemptedMutation = true; return null; },
          print: () => null,
        });
        if (attemptedMutation) return { allowed: false, reason: "guards cannot queue canonical mutations" };
        if (Array.isArray(value)) {
          const allowed = value[0];
          const reason = value[1];
          if (allowed === false) return { allowed: false, reason: typeof reason === "string" ? reason : null };
        }
      } catch (error) {
        const detail = error instanceof LuaError ? `${error.kind}: ${error.message}` : String(error);
        this.onLog({ level: "error", message: `${script.path} ${guard}: ${detail}` });
        return { allowed: false, reason: "guard error" };
      }
    }
    return { allowed: true, reason: null };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Playtest runtime is stopped.");
  }
}
