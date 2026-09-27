import { expect, test } from "bun:test";
import { createCreatorScriptRuntime, type CreatorScriptInvocation } from "./creator-runtime";

const source = `
function on_game_resumed(ctx)
  state.before = turns:current().id
  state.is_current = turns:is_current(turns:current())
  state.leader = scores:leader().id
  state.cycle = {}
  for i = 1, #players:list() do state.cycle[i] = turns:next().id end
  scores:add(turns:current(), 1)
end
function restart()
  turns:start(players:get("fresh"))
  state.restarted = turns:current().id
end
`;

function invocation(scriptState: CreatorScriptInvocation["scriptState"]): CreatorScriptInvocation {
  return {
    binding: { scriptId: "rules", bindingId: "rules", props: {} },
    functionName: "on_game_resumed", readOnly: false, scriptState,
    state: {
      entities: {}, settings: {}, scriptState,
      players: { live_b: { id: "live_b" }, fresh: { id: "fresh" }, live_a: { id: "live_a" } },
      seats: {
        seat_3: { playerId: "fresh" }, seat_2: { playerId: "live_b" }, seat_1: { playerId: "live_a" },
      },
    },
    context: {
      roster: [
        { playerId: "live_a", seatId: "seat_1", previousPlayerId: "old_a" },
        { playerId: "live_b", seatId: "seat_2", previousPlayerId: "old_b" },
        { playerId: "fresh", seatId: "seat_3" },
      ],
      removedPlayerIds: ["old_a", "old_b", "departed"],
    },
    bridge: {
      queue() { throw new Error("unexpected command"); },
      randomInt() { throw new Error("unexpected RNG"); },
      randomFloat() { throw new Error("unexpected RNG"); },
      allocateTimerId() { throw new Error("unexpected timer"); },
    },
  };
}

const savedState = {
  creator_owned: { old_a: 123 },
  __stdlib: {
    turns: { active: true, order: ["old_a", "departed", "old_b", "ghost"], index: 3 },
    scores: { old_a: 4, old_b: 7, departed: 99, red_team: 20 },
  },
};

test("resume reconciles stdlib before the hook, preserves current turn and scores, and cycles only live players", async () => {
  const runtime = await createCreatorScriptRuntime({ scripts: { rules: source }, instructionBudget: 50_000 });
  try {
    const request = invocation(savedState);
    const result = await runtime.invoke(request);
    expect(result.ok).toBe(true);
    expect(result.scriptState).toMatchObject({
      creator_owned: { old_a: 123 }, before: "live_b", is_current: true, leader: "live_b",
      cycle: ["fresh", "live_a", "live_b"],
      __stdlib: {
        turns: { active: true, order: ["live_a", "live_b", "fresh"], index: 2 },
        scores: { live_a: 4, live_b: 8, red_team: 20 },
      },
    });
    expect((result.scriptState as { __stdlib: { scores: unknown } }).__stdlib.scores)
      .toEqual({ live_a: 4, live_b: 8, red_team: 20 });
    const again = await runtime.invoke({ ...request, scriptState: result.scriptState! });
    expect(again.ok).toBe(true);
    expect(again.scriptState).toMatchObject({ __stdlib: { scores: { live_b: 9 } } });
    const restarted = await runtime.invoke({ ...request, scriptState: result.scriptState!, functionName: "restart", context: {} });
    expect(restarted.scriptState).toMatchObject({ restarted: "fresh" });
    expect(savedState.__stdlib.scores).toEqual({ old_a: 4, old_b: 7, departed: 99, red_team: 20 });
  } finally { runtime.close(); }
});

test.each([true, false])("missing resume hook reconciles a removed current player with active=%s", async (active) => {
  const runtime = await createCreatorScriptRuntime({ scripts: { rules: "" }, instructionBudget: 50_000 });
  try {
    const request = invocation({ __stdlib: { ...savedState.__stdlib,
      turns: { active, order: ["departed", "old_b"], index: 1 },
    } });
    const result = await runtime.invoke(request);
    expect(result.ok).toBe(true);
    expect(result.handled).toBe(false);
    expect(result.scriptState).toMatchObject({ __stdlib: {
      turns: { active, order: ["live_b", "live_a", "fresh"], index: 1 },
      scores: { live_a: 4, live_b: 7, red_team: 20 },
    } });
    const later = invocation(result.scriptState!);
    const next = await runtime.invoke({ ...later,
      state: { ...later.state, players: { newest: { id: "newest" } }, seats: { seat_1: { playerId: "newest" } } },
      context: { roster: [{ playerId: "newest", seatId: "seat_1", previousPlayerId: "live_b" }], removedPlayerIds: ["live_a", "live_b", "fresh"] },
    });
    expect(next.ok).toBe(true);
    expect(next.scriptState).toMatchObject({ __stdlib: {
      turns: { active, order: ["newest"], index: 1 }, scores: { newest: 7, red_team: 20 },
    } });
    expect(JSON.stringify(next.scriptState)).not.toContain('"live_a":');
  } finally { runtime.close(); }
});

test("ordinary callbacks cannot trigger roster reconciliation through similarly named context fields", async () => {
  const runtime = await createCreatorScriptRuntime({ scripts: { rules: "" }, instructionBudget: 50_000 });
  try {
    const result = await runtime.invoke({ ...invocation(savedState), functionName: "ordinary_callback" });
    expect(result.ok).toBe(true);
    expect(result.scriptState).toEqual(savedState);
  } finally { runtime.close(); }
});
