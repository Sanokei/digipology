import { describe, expect, test } from "bun:test";
import { createInitialState, snapshot, snapshotRequiresScripts } from "./index";

function testSnapshot(entities: Parameters<typeof createInitialState>[0]["entities"] = {}) {
  return snapshot(createInitialState({
    releaseId: "release_script_policy_test",
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    entities,
  }));
}

describe("snapshotRequiresScripts", () => {
  test("returns true when any entity has a script binding", () => {
    expect(snapshotRequiresScripts(testSnapshot({
      rules: {
        id: "rules",
        components: {
          script: { scriptId: "scripts/game.lua", bindingId: "rules", props: {} },
        },
      },
    }))).toBe(true);
  });

  test("returns false without a script binding", () => {
    expect(snapshotRequiresScripts(testSnapshot({
      counter: {
        id: "counter",
        components: { counter: { value: 0, default: 0, min: null, max: null } },
      },
    }))).toBe(false);
  });
});
