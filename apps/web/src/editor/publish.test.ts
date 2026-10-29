import { expect, test } from "bun:test";

import { editableDraftBackup, saveDraftForReview } from "./publish";
import { EditorStore } from "./state/EditorStore";
import { exportBundleText, importBundleAsDraft } from "./state/bundle";
import { deserializeEditorDraft, loadEditorDraft } from "./state/persistence";
import { draftReview } from "../pages/draftReview";

async function savedRasterDraft() {
  return importBundleAsDraft(await Bun.file(new URL("../../../../e2e/fixtures/raster-draft.editor.json", import.meta.url)).text(), "editor-imported");
}

test("desktop review saves the latest real edited draft and keeps artwork/review outside the release", async () => {
  const original = await savedRasterDraft();
  const before = structuredClone(original);
  const store = new EditorStore(original);
  const script = original.bundle.files.find((file) => file.path === "scripts/game.lua")!;
  store.selectScript(script.path);
  expect(store.updateSelectedScript(script.content.replace("previous + ctx.value", "previous + ctx.value + 1"))).toBe(true);
  store.updateDraftMetadata({ title: "Edited dice race", tagline: "One extra point on every roll." });
  const edited = store.getSnapshot().draft;
  expect(edited.bundle.integrity.manifestHash).not.toBe(original.bundle.integrity.manifestHash);
  expect(draftReview(edited)?.stale).toBe(true);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  expect(saveDraftForReview(storage, edited)).toBe(`/playtest/${encodeURIComponent(edited.id)}`);
  const saved = loadEditorDraft(storage, edited.id)!;
  expect(saved).toEqual(edited);
  expect(saved.artwork).toEqual(original.artwork);
  expect(saved.generationReview).toEqual(original.generationReview);
  expect(deserializeEditorDraft(editableDraftBackup(edited))).toEqual(saved);
  const release = JSON.parse(exportBundleText(edited));
  expect(release).toEqual(edited.bundle);
  expect(release).not.toHaveProperty("artwork");
  expect(release).not.toHaveProperty("generationReview");
  expect(original).toEqual(before);
  store.dispose();
});

test("a failed editor save prevents handoff while the full editable backup stays available", async () => {
  const draft = await savedRasterDraft();
  const brokenStorage = { getItem: () => null, setItem: () => { throw new DOMException("Quota", "QuotaExceededError"); }, removeItem: () => undefined };
  expect(() => saveDraftForReview(brokenStorage, draft)).toThrow("Quota");
  const recovered = deserializeEditorDraft(editableDraftBackup(draft))!;
  expect(recovered.artwork).toEqual(draft.artwork);
  expect(recovered.generationReview).toEqual(draft.generationReview);
  expect(recovered.tagline).toBe(draft.tagline);
  expect(recovered.bundle.integrity.manifestHash).toBe(draft.bundle.integrity.manifestHash);
});
