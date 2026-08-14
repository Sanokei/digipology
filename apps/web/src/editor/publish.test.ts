import { expect, test } from "bun:test";

import { prevalidateCreateGame } from "../releaseValidation";
import { readEditorCreatePrefill } from "../pages/createPrefill";
import { draftToCreatePrefill } from "./publish";
import { EditorStore } from "./state/EditorStore";
import { editorTestDraft } from "./state/testFixtures";

test("publish handoff prefills the existing create flow with a valid draft", () => {
  const store = new EditorStore(editorTestDraft());
  store.updateDraftMetadata({ title: "Table Test", tagline: "A known-good editor fixture", slug: "table-test" });
  const state = draftToCreatePrefill(store.getSnapshot().draft);
  const prefill = readEditorCreatePrefill(state)!;
  const checked = prevalidateCreateGame(prefill, prefill.bundleText);
  expect(checked.request).not.toBeNull();
  expect(checked.report.every((item) => item.ok)).toBe(true);
});
