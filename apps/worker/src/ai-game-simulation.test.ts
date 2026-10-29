import { describe, expect, test } from "bun:test";
import { createCreatorScriptRuntime } from "digipology-lua";
import { applyOrderedWithScripts, loadSnapshot, seedInitialRoster, snapshot, type GameSnapshot } from "digipology-kernel";
import { assembleAiGameDraft } from "./ai-games";
import { refineGameDraft } from "./ai-game-refine";
import { simulateDraftReport } from "./ai-game-simulation";

const component = (type: string, data: unknown) => ({ type, dataJson: JSON.stringify(data) });
function draftFor(lua: string, options: { min?: number; max?: number; cards?: boolean; die?: boolean; buttons?: number } = {}) {
  const binding = component("script", { scriptId: "scripts/rules.lua", bindingId: "rules", props: {} });
  const transform = component("transform", { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
  const entities = [{ id: "choose", components: [component("button", { enabled: true, label: "Choose" }), binding] }];
  for (let index = 1; index < (options.buttons ?? 1); index += 1) entities.push({ id: `choose_${index}`, components: [component("button", { enabled: true, label: `Choice ${index}` })] });
  if (options.die) entities.push({ id: "die", components: [transform, component("die", { faces: [1, 2, 3, 4, 5, 6] })] });
  if (options.cards) entities.push(
    { id: "deck", components: [component("container", { items: ["card"], capacity: null, ordering: "canonical", visibility: "public" }), component("deck", { enabled: true })] },
    { id: "card", components: [transform, component("card", { definitionId: "card", faceUp: false })] },
    { id: "hand", components: [component("container", { items: [], capacity: null, ordering: "canonical", visibility: "owner:sim_player_1" }), component("hand", { owner: "sim_player_1", canonicalOrder: true }), { ...binding, dataJson: JSON.stringify({ scriptId: "scripts/rules.lua", bindingId: "hand", props: { role: "hand" } }) }] },
  );
  const result = assembleAiGameDraft({ title: "Simulation fixture", tagline: "Deterministic test only", interactionMode: "scripted", minPlayers: options.min ?? 2, maxPlayers: options.max ?? options.min ?? 2,
    files: [{ path: "scripts/rules.lua", content: lua }], settings: [], entities, scriptStateJson: "{}", rngSeed: [1, 2, 3, 4], definitions: [{ id: "card", label: "Test card", color: "#ffffff" }], refs: [] });
  if (!result.draft) throw new Error(JSON.stringify(result.report));
  return result.draft;
}

describe("bounded strategy action probes", () => {
  test("finds a broken button in a game with no dice and retains a reproducible trigger", async () => {
    const report = await simulateDraftReport(draftFor('function on_press(ctx) error("broken choice") end'), 8);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "lua_runtime_error", severity: "error" });
    expect(report.issues[0]!.message).toContain("button.press");
    expect(report.sessions[0]!.trace.at(-1)).toMatchObject({ accepted: false, ordered: { sequence: 2, actor: { type: "player", playerId: "sim_player_1" }, action: { type: "button.press", payload: { entityId: "choose" } } } });
  });

  test("uses the prompted player even out of turn and samples a failing alternate choice", async () => {
    const draft = draftFor(`function on_start()
  turns:start()
  local roster = players:list()
  ui:prompt(roster[#roster], { id = "trade", title = "Choose", choices = { "keep", "trade" } })
end
function on_prompt(ctx)
  assert(ctx.player.id == ctx.playerId)
  if ctx.response == "trade" then error("trade branch broken") end
  state.winner_id = ctx.player.id
end`);
    const report = await simulateDraftReport(draft, 8);
    expect(report.sessions.find((s) => s.id === "together-2-first")?.winObserved).toBe(true);
    expect(report.sessions.find((s) => s.id === "together-2-last")?.stopped).toBe("script_error");
    expect(report.sessions[0]!.trace[1]!.ordered).toMatchObject({ actor: { playerId: "sim_player_2" }, action: { type: "prompt.respond", payload: { promptId: "trade", response: "keep" } } });
    expect(report.issues[0]!.message).toContain("trade branch broken");
    expect(report.issues[0]!.message).toContain("together-2-last; sequence 2; prompt.respond");
  });

  test("exercises max-player setup and the real join then seat lifecycle after a host starts alone", async () => {
    const draft = draftFor(`function on_start() state.roster = #players:list() end
function on_player_join(ctx) error("late arrival broken") end
function on_press(ctx) state.winner_id = ctx.player.id end`, { min: 2, max: 4 });
    const report = await simulateDraftReport(draft, 8);
    expect(report.sessions.map((s) => s.id)).toEqual(["together-2-first", "together-2-last", "together-4-first", "together-4-last", "late-2-first", "late-2-last"]);
    expect(report.sessions.filter((s) => s.arrival === "together").every((s) => s.winObserved)).toBe(true);
    const late = report.sessions.find((s) => s.arrival === "late")!;
    expect(late.trace.map((t) => t.ordered.action.type)).toEqual(["system.game_start", "system.player_joined"]);
    expect(report.issues[0]!.message).toContain("late arrival broken");
  });

  test("fires a scheduled callback without a wall-clock wait and bounds repeated timers", async () => {
    const draft = draftFor(`function on_start() timer:after(5000, "finish") end
function on_press() end
function finish() error("timer branch broken") end`);
    const report = await simulateDraftReport(draft, 8);
    expect(report.issues[0]!.message).toContain("timer branch broken");
    expect(report.sessions[0]!.trace.at(-1)!.ordered.action.type).toBe("system.timer_fire");
    const loop = await simulateDraftReport(draftFor(`function on_start() timer:after(1, "again") end
function again() timer:after(1, "again") end`), 5);
    expect(loop.sessions.every((s) => s.stopped === "action_limit")).toBe(true);
    expect(loop.sessions.every((s) => s.trace.length <= 8)).toBe(true);
  });

  test("draws to the acting player's actual hand and calls the bound container callback", async () => {
    const report = await simulateDraftReport(draftFor(`function on_press() end
function on_container_add(ctx) error("draw branch broken") end`, { cards: true }), 8);
    const draw = report.sessions[0]!.trace.find((t) => t.ordered.action.type === "deck.draw_to_container");
    expect(draw?.ordered).toMatchObject({ actor: { playerId: "sim_player_1" }, action: { payload: { target: "hand", count: 1 } } });
    expect(report.issues.some((issue) => issue.message.includes("draw branch broken"))).toBe(true);
  });

  test("a changing unbound die does not count as rule progress, and guard denial is not a Lua error", async () => {
    const report = await simulateDraftReport(draftFor('function can_press() return false end', { die: true }), 8);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.issues.map((i) => i.code)).toContain("game_no_progress");
    expect(report.sessions[0]!.trace.some((t) => !t.accepted)).toBe(true);
  });

  test("reports are deterministic, authored state is unchanged, and recorded actions replay to the same hash", async () => {
    const source = 'function on_press(ctx) state.winner_id = ctx.player.id end';
    const draft = draftFor(source);
    const before = JSON.stringify(draft);
    const report = await simulateDraftReport(draft, 8);
    expect(await simulateDraftReport(draft, 8)).toEqual(report);
    expect(JSON.stringify(draft)).toBe(before);
    const session = report.sessions[0]!;
    let state = seedInitialRoster(loadSnapshot(draft.initialSnapshot as unknown as GameSnapshot), [1, 2].map((n) => ({ playerId: `sim_player_${n}`, name: `Player ${n}`, seatId: `seat_${n}` })));
    const runtime = await createCreatorScriptRuntime({ scripts: { "scripts/rules.lua": source }, instructionBudget: 100_000 });
    try {
      expect(snapshot(state).stateHash).toBe(session.initialStateHash);
      for (const entry of session.trace) {
        const result = await applyOrderedWithScripts(state, entry.ordered, { runtime });
        state = result.state;
        expect(snapshot(state).stateHash).toBe(entry.stateHash);
      }
    } finally { runtime.close(); }
  });

  test("minimum rosters are never silently clamped to four players", async () => {
    const report = await simulateDraftReport(draftFor('function on_press(ctx) assert(#players:list() == 8); state.winner_id = ctx.player.id end', { min: 8 }), 2);
    expect(report.sessions.every((s) => s.playerCount === 8 && s.winObserved)).toBe(true);
    expect(report.issues).toEqual([]);
    const joins = report.sessions.find((s) => s.arrival === "late")!.trace.map((t) => t.ordered.action.type);
    expect(joins.slice(0, 5)).toEqual(["system.game_start", "system.player_joined", "system.seat_assign", "system.player_joined", "system.seat_assign"]);
  });

  test("number and confirmation probes use valid alternate responses", async () => {
    const number = await simulateDraftReport(draftFor(`function on_start()
  ui:number_prompt(players:list()[1], { id = "bid", title = "Bid", min = 1, max = 10, step = 2 })
end
function on_prompt(ctx) state.winner_id = ctx.player.id end`), 8);
    expect(number.sessions[0]!.trace[1]!.ordered.action.payload).toEqual({ promptId: "bid", response: 1 });
    expect(number.sessions[1]!.trace[1]!.ordered.action.payload).toEqual({ promptId: "bid", response: 9 });
    expect(number.issues).toEqual([]);
    const confirm = await simulateDraftReport(draftFor(`function on_start() ui:confirm(players:list()[1], { id = "ready", title = "Ready?" }) end
function on_prompt(ctx) state.winner_id = ctx.player.id end`), 8);
    expect(confirm.sessions[0]!.trace[1]!.ordered.action.payload).toEqual({ promptId: "ready", response: true });
    expect(confirm.sessions[1]!.trace[1]!.ordered.action.payload).toEqual({ promptId: "ready", response: false });
    expect(confirm.issues).toEqual([]);
  });

  test("a no-dice runtime failure enters real repair; unresolved failure cannot be accepted", async () => {
    const draft = draftFor('function on_press(ctx) error("choose branch broken") end');
    let calls = 0;
    const fixed = await refineGameDraft({ draft, userPrompt: "A game with a choice", simulateRolls: 2, maxRounds: 1, refinementAttempts: 1,
      fetch: async (request) => {
        calls += 1;
        expect(request.messages.at(-1)?.content).toContain("button.press");
        return { choices: [{ message: { content: JSON.stringify({ files: [{ path: "scripts/rules.lua", content: 'function on_press(ctx) state.winner_id = ctx.player.id end' }] }) } }] };
      } });
    expect(calls).toBe(1);
    expect(fixed.accepted).toBe(true);
    expect(fixed.issues).toEqual([]);
    const unresolved = await refineGameDraft({ draft, userPrompt: "A game with a choice", simulateRolls: 2, maxRounds: 1, refinementAttempts: 1, fetch: async () => null });
    expect(unresolved.accepted).toBe(false);
    expect(unresolved.issues.some((issue) => issue.code === "lua_runtime_error")).toBe(true);
  });

  test("large choice surfaces report bounded coverage and invalid execution bounds are rejected", async () => {
    const report = await simulateDraftReport(draftFor('function on_press() end', { buttons: 140 }), 1);
    expect(report.sessions.every((session) => session.candidateLimitReached)).toBe(true);
    expect(report.issues.some((issue) => issue.code === "game_playtest_coverage_limited" && issue.severity === "warning")).toBe(true);
    const draft = draftFor('function on_press() end');
    await expect(simulateDraftReport(draft, 97)).rejects.toThrow("action limit");
    await expect(simulateDraftReport({ ...draft, maxPlayers: 65 }, 1)).rejects.toThrow("player range");
  });
});
