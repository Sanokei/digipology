import { expect, test } from "bun:test";
import { createDiceGameEditorDraft, rebuildDraftIntegrity } from "../editor/state/bundle";
import { deserializeEditorDraft } from "../editor/state/persistence";
import { updateScript } from "../editor/state/scripts";
import { draftReview } from "./draftReview";

test("review suggestions stay tied to the authored version and react to actual rule edits", () => {
  const draft = createDiceGameEditorDraft("review", "2026-01-01T00:00:00Z");
  draft.generationReview = { manifestHash: draft.bundle.integrity.manifestHash, warnings: [{ code: "game_win_unobserved", message: "Internal callback diagnostic" }, { code: "game_win_unobserved", message: "Another sample" }] };
  expect(draftReview(draft)).toEqual({ stale: false, suggestions: ["Play through to a winner and check that the ending is clear."] });
  const script = draft.bundle.files.find((file) => file.path.endsWith(".lua"))!;
  updateScript(draft, script.path, `${script.content}\n-- changed rules\n`);
  rebuildDraftIntegrity(draft);
  expect(draftReview(draft)?.stale).toBe(true);
  expect(draftReview(draft)?.suggestions.join(" ")).toContain("choices you changed");
});

test("clean and older drafts have no review interruption", () => {
  const draft = createDiceGameEditorDraft("review", "2026-01-01T00:00:00Z");
  expect(draftReview(draft)).toBeNull();
  draft.generationReview = { manifestHash: draft.bundle.integrity.manifestHash, warnings: [] };
  expect(draftReview(draft)).toBeNull();
});

test("malformed optional review metadata does not make a valid saved game unreadable", () => {
  const draft = createDiceGameEditorDraft("review", "2026-01-01T00:00:00Z");
  for (const review of [null, { manifestHash: "bad", warnings: [] }, { manifestHash: draft.bundle.integrity.manifestHash, warnings: "bad" }, { manifestHash: draft.bundle.integrity.manifestHash, warnings: [{ code: "", message: "bad" }] }]) {
    const restored = deserializeEditorDraft(JSON.stringify({ ...draft, generationReview: review }));
    expect(restored?.bundle).toEqual(draft.bundle);
    expect(restored?.generationReview).toBeUndefined();
  }
});

test("unfamiliar diagnostics become a player-facing action without exposing code details", () => {
  const draft = createDiceGameEditorDraft("review", "2026-01-01T00:00:00Z");
  for (const code of ["lua_unknown_callback", "constructor", "__proto__", "toString"]) {
    draft.generationReview = { manifestHash: draft.bundle.integrity.manifestHash, warnings: [{ code, message: "scripts/internal.lua:on_unsupported" }] };
    expect(draftReview(draft)?.suggestions).toEqual(["Try every action in the rules and check that the table responds as expected."]);
  }
});
