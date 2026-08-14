import { describe, expect, test } from "bun:test";

import { EditorStore } from "./EditorStore";
import { scriptContent, scriptFiles } from "./scripts";
import { editorTestDraft } from "./testFixtures";

describe("project script documents", () => {
  test("create, edit, rename, and delete are undoable bundle commands", () => {
    const store = new EditorStore(editorTestDraft());
    expect(store.createScript("scoring")).toBe(true);
    expect(store.getSnapshot().selectedScriptPath).toBe("scripts/scoring.lua");
    expect(store.updateSelectedScript("function score()\nend\n")).toBe(true);
    expect(scriptContent(store.getSnapshot().draft, "scripts/scoring.lua")).toContain("score");
    expect(store.renameSelectedScript("round/scoring.lua")).toBe(true);
    expect(scriptFiles(store.getSnapshot().bundle).map((file) => file.path)).toContain("scripts/round/scoring.lua");
    const history = store.getSnapshot().past.length;
    expect(store.deleteSelectedScript()).toBe(true);
    store.undo();
    expect(store.getSnapshot().past).toHaveLength(history);
    expect(scriptFiles(store.getSnapshot().bundle).map((file) => file.path)).toContain("scripts/round/scoring.lua");
  });
});
