import { expect, test } from "bun:test";
import { authoredRules, readRulebook } from "./rulebook";

test("authored release rules take precedence without changing their integrity artifact", () => {
  const bundle = { title: "Moon Harbor", releaseId: "builtin_dice_dash_3", files: [
    { path: "runtime/rules.md", content: "# Moon Harbor\n\nCollect three cargo cards to win.", contentHash: "unchanged", byteLength: 48 },
  ] };
  const before = JSON.stringify(bundle);
  expect(readRulebook(bundle)).toEqual({ title: "Moon Harbor", body: bundle.files[0]!.content, source: "release" });
  expect(JSON.stringify(bundle)).toBe(before);
});
test("legacy published guides are specific to supported releases and explain their actual mechanics", () => {
  expect(readRulebook({ title: "Dice Dash", releaseId: "builtin_dice_dash_3", files: [] })?.body).toContain("20 points");
  expect(readRulebook({ title: "First Deal", releaseId: "builtin_first_deal_1", files: [] })?.body).toContain("does not award a winner automatically");
  expect(readRulebook({ title: "Unknown", releaseId: "custom_game_1", files: [] })).toBeNull();
  expect(readRulebook({ title: "Unknown", releaseId: "__proto__", files: [] })).toBeNull();
  expect(readRulebook({ title: "Unknown", releaseId: "constructor", files: [] })).toBeNull();
});
test("empty, oversized and control-character rulebooks are not presented as readable guides", () => {
  for (const content of ["  ", "a".repeat(32_769), "Rules\u0000secret"]) {
    expect(authoredRules({ files: [{ path: "runtime/rules.md", content, contentHash: "unused", byteLength: content.length }] })).toBeNull();
  }
});
