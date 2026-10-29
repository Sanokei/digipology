import { expect, test } from "bun:test";
import { applyOrderedWithScripts, snapshot, type CanonicalGameState, type GameSnapshot, type OrderedActionInput } from "digipology-kernel";
import { createCreatorScriptRuntime, scriptsFromReleaseFiles } from "digipology-lua";
import { builtinCatalog } from "./catalog";
import { createBuiltinInitialState } from "./initial-state";
import golden from "../../../packages/demo-games/fixtures/dice-dash-replay-v3.json";
const fixture = golden as unknown as { initialSnapshot: GameSnapshot; actions: OrderedActionInput<unknown>[]; expectedFinalStateHash: string };

interface Progress {
  winner_id?: string;
  __stdlib: { turns: { active: boolean; order: string[]; index: number }; scores: Record<string, number> };
}

test("the live Dice Dash release plays to a winner with deterministic scores and alternating turns", async () => {
  const bundle = builtinCatalog.getRelease("builtin_dice_dash_3")!.bundle;
  const runtime = await createCreatorScriptRuntime({
    instructionBudget: 50_000, memoryBudgetBytes: 512 * 1024,
    scripts: scriptsFromReleaseFiles(bundle.files), refs: bundle.refs ?? {}, definitions: bundle.definitions ?? {},
  });
  let state = createBuiltinInitialState(bundle.releaseId, [
    { playerId: "alice", displayName: "Alice" }, { playerId: "bob", displayName: "Bob" },
  ])!;
  expect(snapshot(state)).toEqual(fixture.initialSnapshot);
  async function apply(type: string, playerId?: string) {
    const action: OrderedActionInput<unknown> = {
      sequence: state.sequence + 1, actionId: `game-${state.sequence + 1}`,
      actor: playerId === undefined ? { type: "system" as const } : { type: "player" as const, playerId },
      action: { type, payload: type === "die.roll" ? { entityId: "die" } : {} },
    };
    expect(action).toEqual(fixture.actions[state.sequence]!);
    const result = await applyOrderedWithScripts(state, action, { runtime });
    expect(result.rejection).toBeUndefined();
    expect(result.events.filter((event) => event.type === "script.error")).toEqual([]);
    state = result.state;
  }
  try {
    await apply("system.game_start");
    let rolls = 0;
    while (!(state.scriptState as unknown as Progress).winner_id && rolls < 40) {
      const progress = state.scriptState as unknown as Progress;
      const current = progress.__stdlib.turns.order[progress.__stdlib.turns.index - 1]!;
      await apply("die.roll", current);
      rolls += 1;
    }
    const progress = state.scriptState as unknown as Progress;
    expect(rolls).toBeGreaterThan(1);
    expect(rolls).toBeLessThan(40);
    expect(progress.winner_id).toMatch(/^(alice|bob)$/);
    expect(progress.__stdlib.scores[progress.winner_id!]).toBe(20);
    expect(progress.__stdlib.turns.active).toBe(false);
    expect(state.entities.status?.components.text?.value).toContain("wins Dice Dash!");
    expect(snapshot(state).stateHash).toBe(fixture.expectedFinalStateHash);
  } finally { runtime.close(); }
});

test("an out-of-turn roll rolls back the die, score, and RNG", async () => {
  const bundle = builtinCatalog.getRelease("builtin_dice_dash_3")!.bundle;
  const runtime = await createCreatorScriptRuntime({ scripts: scriptsFromReleaseFiles(bundle.files), refs: bundle.refs ?? {}, instructionBudget: 50_000, memoryBudgetBytes: 512 * 1024 });
  try {
    let state = createBuiltinInitialState(bundle.releaseId, [
      { playerId: "alice", displayName: "Alice" }, { playerId: "bob", displayName: "Bob" },
    ])!;
    state = (await applyOrderedWithScripts(state, {
      sequence: 1, actionId: "start", actor: { type: "system" }, action: { type: "system.game_start", payload: {} },
    }, { runtime })).state;
    const result = await applyOrderedWithScripts(state, {
      sequence: 2, actionId: "wrong-turn", actor: { type: "player", playerId: "bob" },
      action: { type: "die.roll", payload: { entityId: "die" } },
    }, { runtime });
    expect(result.rejection).toBeDefined();
    for (const key of ["entities", "rng", "scriptState"] as const satisfies readonly (keyof CanonicalGameState)[]) {
      expect(result.state[key]).toEqual(state[key]);
    }
  } finally { runtime.close(); }
});
