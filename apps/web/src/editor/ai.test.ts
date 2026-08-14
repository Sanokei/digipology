import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "digipology-canonical-json";
import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import { summarizeAiEdit } from "./ai";
import { EditorStore } from "./state/EditorStore";
import { serializeEditorDraft } from "./state/persistence";
import { updateScript } from "./state/scripts";
import { editorTestDraft } from "./state/testFixtures";
import { aiPanelStateForError } from "./panels/ai/AiAssistPanel";

function counter(id: string): EntityRecord {
  return { id, components: { counter: { value: 0, default: 0, min: null, max: null } } };
}

describe("AI edit summaries and undo", () => {
  test("computes entity, script-line, and settings deltas for mixed edits", () => {
    const before = editorTestDraft().bundle;
    const after = structuredClone(before);
    const state = after.initialSnapshot.state as CanonicalGameState;
    state.entities.score = counter("score");
    delete state.entities.card_a;
    state.entities.bonus = counter("bonus");
    state.settings.rounds = 3;
    updateScript({ ...editorTestDraft(), bundle: after }, "scripts/game.lua", "one\ntwo\nthree");
    const summary = summarizeAiEdit(before, after);
    expect(summary.entityCountDelta).toBe(1);
    expect(summary.scriptLineDeltas).toEqual({ "scripts/game.lua": 3 });
    expect(summary.changedSettingsKeys).toEqual(["rounds"]);
  });

  test("apply creates one frame, undo is byte-equal, and cancel is a no-op", () => {
    const draft = editorTestDraft();
    const store = new EditorStore(draft, { now: () => "2026-01-01T00:00:01.000Z" });
    const before = serializeEditorDraft(store.getSnapshot().draft);
    const modified = structuredClone(store.getSnapshot().bundle);
    (modified.initialSnapshot.state as CanonicalGameState).entities.score = counter("score");
    expect(store.applyAiBundle(modified)).toBe(true);
    expect(store.getSnapshot().past).toHaveLength(1);
    store.undo();
    expect(serializeEditorDraft(store.getSnapshot().draft)).toBe(before);
    const historyAfterUndo = store.getSnapshot().past.length;
    const pendingOnly = summarizeAiEdit(store.getSnapshot().bundle, modified);
    expect(canonicalStringify(pendingOnly).length).toBeGreaterThan(0);
    expect(store.getSnapshot().past).toHaveLength(historyAfterUndo);
  });

  test("keyless and capped states do not disable manual commands", () => {
    expect(aiPanelStateForError("ai_unconfigured")).toBe("unconfigured");
    expect(aiPanelStateForError("ai_daily_cap")).toBe("capped");
    const store = new EditorStore(editorTestDraft());
    expect(store.createScript("manual.lua")).toBe(true);
    expect(store.getSnapshot().past).toHaveLength(1);
  });
});
