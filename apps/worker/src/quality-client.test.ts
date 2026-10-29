import { expect, test } from "bun:test";
import { startQualityServer } from "../../../scripts/quality-server";
import { resolveQualityCheck } from "./quality-client";
import { builtinCatalog } from "./catalog";
import { assembleAiGameDraft, authoringFromBundle } from "./ai-games";
import { readRulebook } from "digipology-protocol";
import type { DraftSimulationReport } from "./ai-game-quality";

test("the HTTP harness playtests a real release and detects broken generated Lua", async () => {
  const server = startQualityServer({ port: 0 });
  try {
    const check = resolveQualityCheck({ AI_QUALITY_BASE_URL: `http://127.0.0.1:${server.port}` })!;
    const bundle = builtinCatalog.getRelease("builtin_dice_dash_3")!.bundle;
    const authoring = authoringFromBundle(bundle);
    const files = authoring.files as Array<{ path: string; content: string }>;
    files.push({ path: "runtime/rules.md", content: readRulebook(bundle)!.body });
    const accepted = assembleAiGameDraft(authoring).draft!;
    const response = await fetch(`http://127.0.0.1:${server.port}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: accepted, requireRules: true }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { issues: Array<{ severity: string }>; simulation: DraftSimulationReport };
    expect(body.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(body.simulation.manifestHash).toBe(accepted.integrity.manifestHash);
    expect(body.simulation.sessions.every((session) => session.winObserved)).toBe(true);
    expect(body.simulation.sessions.some((session) => session.trace.some((entry) => entry.ordered.action.type === "system.seat_assign"))).toBe(true);
    expect(body.simulation.sessions[0]!.trace.at(-1)!.stateHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await check(bundle)).some((issue) => issue.code === "rules_missing")).toBe(true);
    files.find((file) => file.path.endsWith(".lua"))!.content = 'function on_roll(ctx)\n  scene:get("score_seat_1"):add(math.random(1, 6))\nend';
    const broken = assembleAiGameDraft(authoring).draft!;
    expect((await check(broken)).some((issue) => issue.code === "lua_banned_global" && issue.severity === "error")).toBe(true);
    const invalid = await fetch(`http://127.0.0.1:${server.port}/check`, { method: "POST", body: "{}" });
    expect(invalid.status).toBe(400);
  } finally { await server.stop(true); }
}, 20_000);

test("the harness requires authentication before accepting remote playtests", async () => {
  expect(() => startQualityServer({ hostname: "0.0.0.0", port: 0 })).toThrow("authentication");
  const server = startQualityServer({ port: 0, token: "test-quality-token" });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/check`, { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
  } finally { await server.stop(true); }
});
