import { describe, expect, test } from "bun:test";
import type { ReleaseBundleDto } from "digipology-protocol/http";
import { assembleAiGameDraft } from "./ai-games";
import { builtinCatalog } from "./catalog";
import {
  checkDraftQuality,
  critiqueInstructionFollowing,
  simulateDraft,
} from "./ai-game-quality";

const TRANSFORM = JSON.stringify({
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});
const DIE = JSON.stringify({ faces: [1, 2, 3, 4, 5, 6] });
const counter = (value = 0): string =>
  JSON.stringify({ value, default: 0, min: null, max: null });
const scriptComponent = (scriptId: string): string =>
  JSON.stringify({ scriptId, bindingId: "game", props: {} });

const GOOD_LUA = `function on_roll(ctx)
  local turn = (state.turn or 0) % 2 + 1
  state.turn = turn
  local score = scene:get("score_" .. turn)
  local total = score.value + ctx.value
  score:add(ctx.value)
  if total >= settings.targetScore then
    scene:get("winner"):set(turn)
  end
  return true
end
`;

function buildDraft(input: {
  files: Array<{ path: string; content: string }>;
  scriptOn?: "die" | "score_1";
  targetScore?: number;
}): ReleaseBundleDto {
  const firstLua = input.files.find((file) => file.path.endsWith(".lua"))?.path ?? "";
  const entities = [
    {
      id: "die",
      components: [
        { type: "transform", dataJson: TRANSFORM },
        { type: "die", dataJson: DIE },
        ...(input.scriptOn === "die"
          ? [{ type: "script", dataJson: scriptComponent(firstLua) }]
          : []),
      ],
    },
    {
      id: "score_1",
      components: [
        { type: "counter", dataJson: counter() },
        ...(input.scriptOn === "score_1"
          ? [{ type: "script", dataJson: scriptComponent(firstLua) }]
          : []),
      ],
    },
    { id: "score_2", components: [{ type: "counter", dataJson: counter() }] },
    { id: "winner", components: [{ type: "counter", dataJson: counter() }] },
  ];
  const { draft, report } = assembleAiGameDraft({
    title: "Fixture",
    tagline: "test fixture",
    interactionMode: "sandbox",
    minPlayers: 2,
    maxPlayers: 2,
    files: input.files,
    settings: [
      {
        key: "targetScore",
        valueType: "number",
        stringValue: "",
        numberValue: input.targetScore ?? 10,
        booleanValue: false,
      },
    ],
    entities,
    scriptStateJson: "{}",
    rngSeed: [1, 2, 3, 4],
    definitions: [],
  });
  if (draft === null) {
    throw new Error(
      `fixture assembly failed: ${JSON.stringify(report.filter((item) => !item.ok))}`,
    );
  }
  return draft;
}

const goodDraft = (): ReleaseBundleDto =>
  buildDraft({ files: [{ path: "scripts/game.lua", content: GOOD_LUA }], scriptOn: "die" });

const codes = (issues: Array<{ code: string }>): string[] =>
  issues.map((issue) => issue.code);

describe("checkDraftQuality", () => {
  test("a correct dice game passes with no issues", async () => {
    const issues = await checkDraftQuality(goodDraft(), { simulateRolls: 24 });
    expect(issues).toEqual([]);
  }, 30_000);

  test("flags math.random as a banned global", async () => {
    const lua = GOOD_LUA.replace("ctx.value", "math.random(1, 6)");
    const draft = buildDraft({ files: [{ path: "scripts/game.lua", content: lua }], scriptOn: "die" });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    expect(codes(issues)).toContain("lua_banned_global");
    expect(issues.find((issue) => issue.code === "lua_banned_global")?.severity).toBe("error");
  });

  test("flags invented random_int/randint globals with the correct API", async () => {
    const lua = GOOD_LUA.replace("ctx.value", "random_int(1, 6)");
    const draft = buildDraft({ files: [{ path: "scripts/game.lua", content: lua }], scriptOn: "die" });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    const banned = issues.find((issue) => issue.code === "lua_banned_global");
    expect(banned?.severity).toBe("error");
    expect(banned?.message).toContain("random:int(min, max)");
  });

  test("flags Lua syntax errors with the file", async () => {
    const draft = buildDraft({
      files: [{ path: "scripts/game.lua", content: "function on_roll(ctx)\n  this is not lua\nend" }],
      scriptOn: "die",
    });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    const syntax = issues.find((issue) => issue.code === "lua_syntax_error");
    expect(syntax?.severity).toBe("error");
    expect(syntax?.message).toContain("scripts/game.lua");
  });

  test("flags scripts that no entity binds", async () => {
    const draft = buildDraft({ files: [{ path: "scripts/game.lua", content: GOOD_LUA }] });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    const unbound = issues.find((issue) => issue.code === "lua_script_unbound");
    expect(unbound?.severity).toBe("warning");
    expect(unbound?.message).toContain("scripts/game.lua");
    const noBindings = issues.find((issue) => issue.code === "lua_no_bindings");
    expect(noBindings?.severity).toBe("error");
  });

  test("flags a script component pointing at a missing file", async () => {
    const draft = goodDraft();
    // Rewrite the binding to a nonexistent file via the snapshot state.
    const state = draft.initialSnapshot.state as unknown as {
      entities: Record<string, { components: Record<string, { scriptId: string }> }>;
    };
    state.entities.die!.components.script!.scriptId = "scripts/missing.lua";
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    expect(codes(issues)).toContain("lua_script_missing");
  });

  test("warns when a callback can never fire on its bound entity", async () => {
    const draft = buildDraft({
      files: [{ path: "scripts/game.lua", content: GOOD_LUA }],
      scriptOn: "score_1",
    });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    const warning = issues.find((issue) => issue.code === "lua_callback_never_fires");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("on_roll");
  });

  test("shared setup and die bindings do not produce a false never-fires repair warning", async () => {
    const draft = builtinCatalog.getRelease("builtin_dice_dash_3")!.bundle;
    const issues = await checkDraftQuality(draft, { simulateRolls: 24 });
    expect(codes(issues)).not.toContain("lua_callback_never_fires");
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("flags settings keys the draft does not define", async () => {
    const lua = GOOD_LUA.replace("settings.targetScore", "settings.target_score");
    const draft = buildDraft({ files: [{ path: "scripts/game.lua", content: lua }], scriptOn: "die" });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    const mismatch = issues.find((issue) => issue.code === "lua_unknown_setting");
    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.message).toContain("target_score");
  });

  test("flags scene:get on unknown entity IDs", async () => {
    const lua = GOOD_LUA.replace('scene:get("winner")', 'scene:get("nope")');
    const draft = buildDraft({ files: [{ path: "scripts/game.lua", content: lua }], scriptOn: "die" });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    const unknown = issues.find((issue) => issue.code === "lua_unknown_entity");
    expect(unknown?.severity).toBe("error");
    expect(unknown?.message).toContain("nope");
  });

  test("captures Lua runtime errors from the playtest", async () => {
    const draft = buildDraft({
      files: [{ path: "scripts/game.lua", content: 'function on_roll(ctx)\n  error("boom")\nend' }],
      scriptOn: "die",
    });
    const issues = await simulateDraft(draft, 4);
    const runtime = issues.find((issue) => issue.code === "lua_runtime_error");
    expect(runtime?.severity).toBe("error");
    expect(runtime?.message).toContain("boom");
    expect(runtime?.message).toContain("on_roll");
  }, 30_000);

  test("a placeholder draft is flagged as logic-less, unwired, and winless", async () => {
    const draft = buildDraft({
      files: [
        { path: "runtime/main.lua", content: "-- game rules" },
        { path: "scripts/setup.lua", content: "-- setup" },
      ],
    });
    const issues = await checkDraftQuality(draft, { simulateRolls: 12 });
    expect(codes(issues)).toContain("lua_no_logic");
    expect(issues.find((issue) => issue.code === "lua_no_logic")?.severity).toBe("error");
    expect(codes(issues)).toContain("lua_no_bindings");
    expect(codes(issues)).toContain("lua_script_unbound");
    expect(codes(issues)).toContain("game_win_unobserved");
    expect(issues.every((issue) => issue.code !== "lua_syntax_error")).toBe(true);
  }, 30_000);

  test("a draft with one real script does not flag the other empty file as an error", async () => {
    const draft = buildDraft({
      files: [
        { path: "scripts/game.lua", content: GOOD_LUA },
        { path: "scripts/setup.lua", content: "-- setup" },
      ],
      scriptOn: "die",
    });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    expect(codes(issues)).not.toContain("lua_no_logic");
    expect(codes(issues)).toContain("lua_empty_file");
    expect(issues.find((issue) => issue.code === "lua_empty_file")?.severity).toBe("warning");
  });

  test("does not flag commented-out banned globals", async () => {
    const lua = `-- math.random(1, 6) was here\n${GOOD_LUA}`;
    const draft = buildDraft({ files: [{ path: "scripts/game.lua", content: lua }], scriptOn: "die" });
    const issues = await checkDraftQuality(draft, { simulateRolls: 0 });
    expect(codes(issues)).not.toContain("lua_banned_global");
  });
});

describe("critiqueInstructionFollowing", () => {
  test("converts model-reported mismatches into error issues", async () => {
    const fetch = async (): Promise<unknown> => ({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { code: "dice_count", message: "Draft uses 2 dice but the request said 1 die." },
            ]),
          },
        },
      ],
    });
    const issues = await critiqueInstructionFollowing({
      fetch,
      userPrompt: "1 die game",
      draft: goodDraft(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "dice_count",
      severity: "error",
      message: "Draft uses 2 dice but the request said 1 die.",
    });
  });

  test("an empty model verdict means no issues, and transport failure is silent", async () => {
    const empty = async (): Promise<unknown> => ({
      choices: [{ message: { content: "[]" } }],
    });
    expect(
      await critiqueInstructionFollowing({ fetch: empty, userPrompt: "x", draft: goodDraft() }),
    ).toEqual([]);
    const failing = async (): Promise<unknown> => null;
    expect(
      await critiqueInstructionFollowing({ fetch: failing, userPrompt: "x", draft: goodDraft() }),
    ).toEqual([]);
  });
});
