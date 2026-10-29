import { describe, expect, test } from "bun:test";
import type { ReleaseBundleDto } from "digipology-protocol/http";
import { assembleAiGameDraft } from "./ai-games";
import {
  applyGamePatch,
  buildGameRefinementRequest,
  extractRefinement,
  refineGameDraft,
  validateRefinement,
  type GameDraftPatch,
} from "./ai-game-refine";

const TRANSFORM = JSON.stringify({
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

const BROKEN_LUA = `function on_roll(ctx)
  local roll = math.random(1, 6)
  scene:get("score_1"):add(roll)
  return true
end
`;

const FIXED_LUA = `function on_roll(ctx)
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

function buildDraft(lua: string): ReleaseBundleDto {
  const counter = JSON.stringify({ value: 0, default: 0, min: null, max: null });
  const { draft, report } = assembleAiGameDraft({
    title: "Refine Fixture",
    tagline: "test fixture",
    interactionMode: "sandbox",
    minPlayers: 2,
    maxPlayers: 2,
    files: [{ path: "scripts/game.lua", content: lua }],
    settings: [
      { key: "targetScore", valueType: "number", stringValue: "", numberValue: 10, booleanValue: false },
    ],
    entities: [
      {
        id: "die",
        components: [
          { type: "transform", dataJson: TRANSFORM },
          { type: "die", dataJson: JSON.stringify({ faces: [1, 2, 3, 4, 5, 6] }) },
          {
            type: "script",
            dataJson: JSON.stringify({ scriptId: "scripts/game.lua", bindingId: "game", props: {} }),
          },
        ],
      },
      { id: "score_1", components: [{ type: "counter", dataJson: counter }] },
      { id: "score_2", components: [{ type: "counter", dataJson: counter }] },
      { id: "winner", components: [{ type: "counter", dataJson: counter }] },
    ],
    scriptStateJson: "{}",
    rngSeed: [7, 8, 9, 10],
    definitions: [],
  });
  if (draft === null) {
    throw new Error(`fixture failed: ${JSON.stringify(report.filter((item) => !item.ok))}`);
  }
  return draft;
}

function openAiResponse(content: string): unknown {
  return { choices: [{ message: { role: "assistant", content } }] };
}

describe("extractRefinement", () => {
  test("extracts a files patch, tolerating markdown fences", () => {
    const patch = extractRefinement(
      openAiResponse('```json\n{"files":[{"path":"scripts/game.lua","content":"x"}]}\n```'),
    );
    expect(patch).toEqual({ files: [{ path: "scripts/game.lua", content: "x" }] });
  });

  test("rejects unknown keys and empty payloads", () => {
    expect(extractRefinement(openAiResponse('{"scripts":{"a":1}}'))).toBeNull();
    expect(extractRefinement(openAiResponse("{}"))).toBeNull();
    expect(extractRefinement(openAiResponse("not json at all"))).toBeNull();
    expect(extractRefinement(null)).toBeNull();
  });
});

describe("validateRefinement", () => {
  const valid: GameDraftPatch = {
    files: [{ path: "scripts/game.lua", content: FIXED_LUA }],
  };
  test("accepts a well-formed patch", () => {
    expect(validateRefinement(valid)).toEqual([]);
  });

  test("rejects bad file paths and shapes", () => {
    expect(validateRefinement({ files: [] }).length).toBeGreaterThan(0);
    expect(
      validateRefinement({ files: [{ path: "../evil.lua", content: "x" }] }).length,
    ).toBeGreaterThan(0);
    expect(
      validateRefinement({ files: [{ path: "scripts/game.txt", content: "x" }] }).length,
    ).toBeGreaterThan(0);
  });

  test("accepts the {key, value} settings shorthand and object scriptStateJson", () => {
    expect(
      validateRefinement({ settings: [{ key: "targetScore", value: 30 } as never] }),
    ).toEqual([]);
    expect(validateRefinement({ scriptStateJson: { turn: 1 } as never })).toEqual([]);
  });

  test("rejects malformed entities/settings/scriptStateJson", () => {
    expect(
      validateRefinement({ entities: [{ id: "", components: [] }] }).length,
    ).toBeGreaterThan(0);
    expect(
      validateRefinement({
        settings: [{ key: "k", valueType: "bogus", stringValue: "", numberValue: 0, booleanValue: false }],
      }).length,
    ).toBeGreaterThan(0);
    expect(validateRefinement({ scriptStateJson: "{oops" }).length).toBeGreaterThan(0);
    expect(validateRefinement({ scriptStateJson: '{"turn":1}' })).toEqual([]);
  });
});

describe("applyGamePatch", () => {
  test("splices new Lua into the draft and re-hashes", () => {
    const before = buildDraft(BROKEN_LUA);
    const after = applyGamePatch(before, {
      files: [{ path: "scripts/game.lua", content: FIXED_LUA }],
    });
    expect(after).not.toBeNull();
    expect(after!.files.find((file) => file.path === "scripts/game.lua")?.content).toBe(FIXED_LUA);
    expect(after!.integrity.manifestHash).not.toBe(before.integrity.manifestHash);
    expect(after!.gameId).toBe(before.gameId);
    expect(after!.releaseId).toBe(before.releaseId);
  });

  test("returns null when the patched draft is structurally invalid", () => {
    const before = buildDraft(BROKEN_LUA);
    const after = applyGamePatch(before, {
      entities: [{ id: "die", components: [{ type: "not-a-component", dataJson: "{}" }] }],
    });
    expect(after).toBeNull();
  });
});

describe("buildGameRefinementRequest", () => {
  test("uses a bounded repair budget without Qwen-specific defaults", () => {
    const draft = buildDraft(BROKEN_LUA);
    const request = buildGameRefinementRequest(
      draft,
      [{ code: "lua_banned_global", message: "uses math.random", severity: "error" }],
      "make a dice game",
    );
    expect(request.max_tokens).toBe(8_000);
    const user = request.messages[request.messages.length - 1]!;
    expect(user.role).toBe("user");
    expect(user.content).not.toContain("/no_think");
    expect(user.content).toContain("lua_banned_global");
    expect(user.content).toContain("scripts/game.lua");
    expect(request.extraBody).toBeUndefined();
  });
});

describe("refineGameDraft", () => {
  test("fixes a banned global through one refinement round", async () => {
    const draft = buildDraft(BROKEN_LUA);
    const patchJson = JSON.stringify({
      files: [{ path: "scripts/game.lua", content: FIXED_LUA }],
    });
    let calls = 0;
    const fetch = async (): Promise<unknown> => {
      calls += 1;
      return openAiResponse(patchJson);
    };
    const events: string[] = [];
    const result = await refineGameDraft({
      fetch,
      draft,
      userPrompt: "2 players take turns rolling one die, first to 10 wins",
      checkInstructions: false,
      simulateRolls: 24,
      maxRounds: 3,
      onProgress: (event) => events.push(event.type),
    });
    // Call 1 is the generation pass-through (no model hit); call 2 is the patch.
    expect(calls).toBe(1);
    expect(result.accepted).toBe(true);
    expect(result.rounds).toBe(1);
    expect(result.draft).not.toBeNull();
    expect(
      result.draft!.files.find((file) => file.path === "scripts/game.lua")?.content,
    ).toBe(FIXED_LUA);
    expect(events).toContain("refinement_started");
    expect(events).toContain("refinement_done");
  }, 60_000);

  test("keeps the original draft when the model cannot fix anything", async () => {
    const draft = buildDraft(BROKEN_LUA);
    const fetch = async (): Promise<unknown> => openAiResponse("still broken, no json here");
    const result = await refineGameDraft({
      fetch,
      draft,
      userPrompt: "2 players take turns rolling one die, first to 10 wins",
      checkInstructions: false,
      simulateRolls: 0,
      maxRounds: 2,
      refinementAttempts: 1,
    });
    expect(result.accepted).toBe(false);
    expect(result.draft).not.toBeNull();
    expect(
      result.draft!.files.find((file) => file.path === "scripts/game.lua")?.content,
    ).toBe(BROKEN_LUA);
    expect(result.issues.some((issue) => issue.code === "lua_banned_global")).toBe(true);
  }, 60_000);
});
