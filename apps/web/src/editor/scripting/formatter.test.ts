import { describe, expect, test } from "bun:test";

import { formatLua } from "./formatter";

describe("StyLua format-on-save", () => {
  test("is stable and idempotent", async () => {
    const once = await formatLua("function on_start(ctx)\nstate.turn=1\nend");
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = await formatLua(once.value);
    expect(twice).toEqual({ ok: true, value: once.value });
    expect(once.value).toContain("state.turn = 1");
  });

  test("leaves invalid Lua untouched and reports the failure", async () => {
    const source = "function broken(";
    const result = await formatLua(source);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(source);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
