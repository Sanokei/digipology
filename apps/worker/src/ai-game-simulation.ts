import { canonicalStringify, hashValue } from "digipology-canonical-json";
import type { QualityIssue } from "digipology-ai";
import {
  applyOrderedWithScripts, loadSnapshot, seedInitialRoster, snapshot,
  type CanonicalGameState, type GameSnapshot, type JsonValue,
  type KernelEvent, type OrderedActionInput, type PromptRecord,
} from "digipology-kernel";
import { createCreatorScriptRuntime, scriptsFromReleaseFiles } from "digipology-lua";
import type { ReleaseBundleDto } from "digipology-protocol/http";

export interface SimulationTraceEntry {
  ordered: OrderedActionInput;
  accepted: boolean;
  rejection?: string;
  stateHash: string;
  events: string[];
}

export interface SimulationSession {
  id: string;
  playerCount: number;
  arrival: "together" | "late";
  choices: "first" | "last";
  initialStateHash: string;
  trace: SimulationTraceEntry[];
  actionsApplied: number;
  progressObserved: boolean;
  winObserved: boolean;
  candidateLimitReached: boolean;
  stopped: "winner" | "script_error" | "no_actions" | "action_limit";
}

export interface DraftSimulationReport {
  version: 1;
  manifestHash: string;
  actionLimitPerSession: number;
  sessions: SimulationSession[];
  issues: QualityIssue[];
}

type Candidate = Pick<OrderedActionInput, "actor" | "action">;
const system = { type: "system" } as const;
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function progressFingerprint(state: CanonicalGameState): string {
  // A changing die face alone is not evidence that the game's rules respond.
  const visible: Record<string, unknown> = {};
  for (const id of Object.keys(state.entities).sort()) {
    const c = state.entities[id]!.components;
    visible[id] = { ...(c.counter ? { counter: c.counter.value } : {}),
      ...(c.text ? { text: c.text.value } : {}), ...(c.container ? { items: c.container.items } : {}) };
  }
  return canonicalStringify({ visible, scriptState: state.scriptState });
}

function winnerDeclared(state: CanonicalGameState): boolean {
  for (const [id, entity] of Object.entries(state.entities)) {
    if (!/winner/i.test(id)) continue;
    const { counter, text } = entity.components;
    if (counter && counter.value !== counter.default || text && text.value !== "") return true;
  }
  const script = record(state.scriptState);
  const winner = script.winner_id ?? script.winner;
  return winner !== undefined && winner !== null && winner !== 0 && winner !== "" && winner !== false;
}

function runtimeIssues(events: KernelEvent[]): QualityIssue[] {
  return events.filter((event) => event.type === "script.error").map((event) => {
    const d = event.data;
    let message = String(d.message ?? "unknown error").slice(0, 1_600);
    if (/nil value/i.test(message) && /random/i.test(message)) message += " Use random:int(min, max), random:float(), or random:choice(list).";
    return { code: "lua_runtime_error", severity: "error" as const,
      message: `Lua ${String(d.function ?? "?")} in ${String(d.script ?? "?")} failed at runtime${typeof d.line === "number" ? ` (line ${d.line})` : ""}: ${message}. The triggering action was rejected, so this breaks the game flow.` };
  });
}

function promptResponse(prompt: PromptRecord, last: boolean): JsonValue {
  if (prompt.kind === "confirm") return !last;
  if (prompt.kind === "choice") return prompt.choices![last ? prompt.choices!.length - 1 : 0]!;
  const min = prompt.min!, max = prompt.max!, step = prompt.step!;
  const high = min + Math.floor((max - min) / step) * step;
  // Match the kernel's exact numeric step check, including floating-point grids.
  return last && high <= max && Number.isFinite(high) && Number.isInteger((high - min) / step) ? high : min;
}

function currentPlayer(state: CanonicalGameState): string | null {
  const turns = record(record(record(state.scriptState).__stdlib).turns);
  const id = turns.active === true && Array.isArray(turns.order) && typeof turns.index === "number" ? turns.order[turns.index - 1] : null;
  return typeof id === "string" && Object.hasOwn(state.players, id) ? id : null;
}

function* candidates(state: CanonicalGameState, last: boolean): Generator<Candidate> {
  const playerIds = Object.keys(state.players).sort();
  const active = currentPlayer(state);
  const actors = active ? [active] : playerIds;
  const ids = Object.keys(state.entities).sort();
  if (last) ids.reverse();
  for (const playerId of actors) {
    const actor = { type: "player", playerId } as const;
    for (const id of ids) {
      const c = state.entities[id]!.components;
      if (c.die) yield { actor, action: { type: "die.roll", payload: { entityId: id } } };
      if (c.button?.enabled) yield { actor, action: { type: "button.press", payload: { entityId: id } } };
      if (!c.deck?.enabled || !c.container?.items.length) continue;
      for (const handId of ids) {
        const hand = state.entities[handId]!.components;
        const owner = hand.hand?.owner;
        const ownsHand = typeof owner === "string" &&
          (owner === playerId || state.seats[owner]?.playerId === playerId);
        if (handId !== id && ownsHand && hand.container &&
          (hand.container.capacity === null || hand.container.items.length < hand.container.capacity)) {
          yield { actor, action: { type: "deck.draw_to_container", payload: { deckId: id, target: handId, count: 1 } } };
        }
      }
    }
  }
}

/** Bounded deterministic probes, never a proof of balance, strategy or fun. */
export async function simulateDraftReport(
  draft: ReleaseBundleDto, actionLimit = 48, instructionBudget = 100_000,
): Promise<DraftSimulationReport> {
  if (!Number.isSafeInteger(actionLimit) || actionLimit < 1 || actionLimit > 96) throw new TypeError("Playtest action limit must be an integer from 1 through 96");
  if (!Number.isSafeInteger(draft.minPlayers) || !Number.isSafeInteger(draft.maxPlayers) || draft.minPlayers < 1 || draft.maxPlayers > 64 || draft.maxPlayers < draft.minPlayers) throw new TypeError("Playtest requires a supported player range");
  const report: DraftSimulationReport = { version: 1, manifestHash: draft.integrity.manifestHash, actionLimitPerSession: actionLimit, sessions: [], issues: [] };
  const scripts = scriptsFromReleaseFiles(draft.files);
  if (Object.keys(scripts).length === 0) return report;
  const seenIssues = new Set<string>();
  const addIssue = (issue: QualityIssue, session: SimulationSession, trigger?: OrderedActionInput) => {
    const key = `${issue.code}:${issue.message}`;
    if (seenIssues.has(key)) return;
    seenIssues.add(key);
    report.issues.push({ ...issue, message: `${issue.message} [${session.id}${trigger ? `; sequence ${trigger.sequence}; ${trigger.action.type}` : ""}]` });
  };
  const min = draft.minPlayers, max = draft.maxPlayers;
  const setups: Array<{ count: number; late: boolean }> = [{ count: min, late: false }];
  if (max !== min) setups.push({ count: max, late: false });
  if (max > 1) setups.push({ count: Math.max(2, min), late: true });
  for (const setup of setups) for (const last of [false, true]) {
    const roster = Array.from({ length: setup.count }, (_, index) => ({ playerId: `sim_player_${index + 1}`, name: `Player ${index + 1}`, seatId: `seat_${index + 1}` }));
    let state = seedInitialRoster(loadSnapshot(draft.initialSnapshot as unknown as GameSnapshot), setup.late ? roster.slice(0, 1) : roster);
    const session: SimulationSession = {
      id: `${setup.late ? "late" : "together"}-${setup.count}-${last ? "last" : "first"}`,
      playerCount: setup.count, arrival: setup.late ? "late" : "together", choices: last ? "last" : "first",
      initialStateHash: snapshot(state).stateHash, trace: [], actionsApplied: 0,
      progressObserved: false, winObserved: false, candidateLimitReached: false, stopped: "action_limit",
    };
    report.sessions.push(session);
    const runtime = await createCreatorScriptRuntime({ scripts, instructionBudget, memoryBudgetBytes: 512 * 1024, refs: draft.refs ?? {}, definitions: draft.definitions ?? {} });
    const timers = new Map<string, number>();
    let clock = 0;
    let failed = false;
    const apply = async (candidate: Candidate, gameplay = false) => {
      const ordered: OrderedActionInput = { sequence: state.sequence + 1, actionId: `sim-${state.sequence + 1}`, ...candidate };
      const before = progressFingerprint(state);
      const result = await applyOrderedWithScripts(state, ordered, { runtime });
      state = result.state;
      session.trace.push({ ordered, accepted: result.rejection === undefined,
        ...(result.rejection ? { rejection: result.rejection.reason.slice(0, 1_000) } : {}),
        stateHash: snapshot(state).stateHash, events: [...new Set(result.events.map((event) => event.type))].slice(0, 24) });
      const errors = runtimeIssues(result.events);
      for (const issue of errors) addIssue(issue, session, ordered);
      failed ||= errors.length > 0;
      if (!gameplay && result.rejection && errors.length === 0) {
        addIssue({ code: "game_lifecycle_rejected", severity: "error", message: `The live-room lifecycle action ${ordered.action.type} was rejected: ${result.rejection.reason.slice(0, 1_000)}.` }, session, ordered);
        failed = true;
      }
      if (gameplay && !result.rejection) {
        session.actionsApplied += 1;
        session.progressObserved ||= progressFingerprint(state) !== before;
      }
      for (const event of result.events) {
        const id = event.data.timerId;
        if (typeof id !== "string") continue;
        if (event.type === "timer.registered" && typeof event.data.delay === "number") timers.set(id, clock + Math.max(1, Math.ceil(event.data.delay)));
        if (event.type === "timer.fired" || event.type === "timer.canceled") timers.delete(id);
      }
      session.winObserved = winnerDeclared(state);
    };
    try {
      await apply({ actor: system, action: { type: "system.game_start", payload: { settings: state.settings } } });
      if (setup.late && !failed) for (const player of roster.slice(1)) {
        await apply({ actor: system, action: { type: "system.player_joined", payload: { playerId: player.playerId, name: player.name } } });
        if (failed) break;
        await apply({ actor: system, action: { type: "system.seat_assign", payload: { playerId: player.playerId, seatId: player.seatId } } });
        if (failed) break;
      }
      const visits = new Map<string, number>();
      let fingerprint = "", tried = new Set<string>();
      for (let step = 0; step < actionLimit && !failed && !session.winObserved; step += 1) {
        const nextFingerprint = hashValue({ entities: state.entities, script: state.scriptState, prompts: state.prompts ?? {}, timers: state.timers ?? {}, players: state.players, seats: state.seats });
        if (nextFingerprint !== fingerprint) { fingerprint = nextFingerprint; tried = new Set(); }
        const available = (list: Candidate[]) => list.filter((c) => !tried.has(canonicalStringify(c)));
        const prompts = Object.values(state.prompts ?? {}).filter((p) => p.status === "open" && Object.hasOwn(state.players, p.playerId)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        if (last) prompts.reverse();
        let candidate = available(prompts.map((p) => ({ actor: { type: "player", playerId: p.playerId } as const, action: { type: "prompt.respond", payload: { promptId: p.id, response: promptResponse(p, last) } } })))[0];
        const scheduled = [...timers].filter(([id]) => state.timers?.[id]?.status === "scheduled").sort(([a, da], [b, db]) => da - db || (a < b ? -1 : a > b ? 1 : 0));
        const timer = scheduled[0];
        if (!candidate && timer && timer[1] <= clock) candidate = { actor: system, action: { type: "system.timer_fire", payload: { timerId: timer[0] } } };
        if (!candidate) {
          const options: Candidate[] = [];
          for (const option of candidates(state, last)) {
            if (options.length === 256) { session.candidateLimitReached = true; break; }
            options.push(option);
          }
          candidate = available(options).sort((a, b) => (visits.get(canonicalStringify(a)) ?? 0) - (visits.get(canonicalStringify(b)) ?? 0))[0];
        }
        if (!candidate && timer) {
          clock = Math.max(clock, timer[1]);
          candidate = { actor: system, action: { type: "system.timer_fire", payload: { timerId: timer[0] } } };
        }
        if (!candidate) { session.stopped = "no_actions"; break; }
        const key = canonicalStringify(candidate);
        tried.add(key); visits.set(key, (visits.get(key) ?? 0) + 1);
        await apply(candidate, true);
        clock += 1;
      }
      if (failed) session.stopped = "script_error";
      else if (session.winObserved) session.stopped = "winner";
      if (session.candidateLimitReached) addIssue({ code: "game_playtest_coverage_limited", severity: "warning", message: "More than 256 player-action candidates were available in a step. Only a bounded sample was explored; review the remaining choices manually." }, session);
      if (!failed && !session.winObserved && session.stopped === "no_actions") addIssue({ code: "game_playtest_stalled", severity: "warning", message: "The playtest exhausted available dice, buttons, prompts, card draws and timers without a winner. Check the legal next action; drag/placement rules need a manual playtest." }, session);
      if (!failed && !session.progressObserved && !session.winObserved) addIssue({ code: "game_no_progress", severity: "warning", message: `${session.actionsApplied} accepted simulated action(s) changed no score, text, card container or script state. A changing die face alone does not establish rule progress.` }, session);
      const target = Object.keys(state.settings).sort().find((key) => /target|goal|win|score/i.test(key));
      if (!failed && target && !session.winObserved) addIssue({ code: "game_win_unobserved", severity: "warning", message: `The draft has a target-like setting ("${target}") but no winner was declared within ${actionLimit} simulated action attempts. The condition may need a longer or different strategy; this is not proof it is unreachable.` }, session);
    } finally { runtime.close(); }
  }
  return report;
}

/** Backward-compatible exploration setting. Zero is handled by checkDraftQuality. */
export async function simulateDraft(draft: ReleaseBundleDto, rolls = 12, instructionBudget = 100_000): Promise<QualityIssue[]> {
  return (await simulateDraftReport(draft, Math.max(1, Math.min(96, Math.trunc(rolls) * 4)), instructionBudget)).issues;
}
