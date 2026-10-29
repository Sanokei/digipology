import { expect, test } from "bun:test";
import { TABLE_SOUND_PATH } from "digipology-protocol";
import { EditorStore } from "./EditorStore";
import { attachSoundBundle } from "./sounds";
import { exportBundleText, importBundleAsDraft, normalizeEditorDraft } from "./bundle";
import { deserializeEditorDraft, serializeEditorDraft } from "./persistence";
import { KernelStore } from "../../state/kernelStore";
import { soundHash } from "../../audio/bundle";

const soundText = await Bun.file(new URL("../../../public/audio/table-effects/v1/bundle.json", import.meta.url)).text();
const backup = await Bun.file(new URL("../../../../../e2e/fixtures/raster-draft.editor.json", import.meta.url)).json();

test("pinning a presentation sound file changes release integrity but preserves rules, canonical state, artwork and review in normal backup/export", () => {
  const original = normalizeEditorDraft(backup), store = new EditorStore(original, { saveDraft: () => {} });
  expect(store.applySceneCommand("Sound import", (draft) => attachSoundBundle(draft, soundText))).toBe(true);
  const edited = store.getSnapshot().draft;
  expect(edited.bundle.initialSnapshot).toEqual(original.bundle.initialSnapshot);
  expect(edited.bundle.files.filter((file) => file.path !== TABLE_SOUND_PATH)).toEqual(original.bundle.files);
  expect(edited.bundle.integrity.manifestHash).not.toBe(original.bundle.integrity.manifestHash);
  expect(edited.generationReview).toEqual(original.generationReview); expect(edited.artwork).toEqual(original.artwork);
  const restored = deserializeEditorDraft(serializeEditorDraft(edited))!;
  expect(restored.bundle).toEqual(edited.bundle); expect(restored.artwork).toEqual(original.artwork);
  const exported = exportBundleText(edited), release = JSON.parse(exported);
  expect(release.artwork).toBeUndefined(); expect(release.generationReview).toBeUndefined();
  const imported = importBundleAsDraft(exported, "audio-roundtrip");
  expect(imported.bundle.files.find((file) => file.path === TABLE_SOUND_PATH)?.content).toBe(soundText);
  const projection = new KernelStore(); projection.loadRelease(edited.bundle);
  expect(projection.getSnapshot().soundBundle).toBe(soundText); expect(projection.confirmedSnapshot() as unknown).toEqual(original.bundle.initialSnapshot);
  store.undo(); expect(store.getSnapshot().bundle.files.some((file) => file.path === TABLE_SOUND_PATH)).toBe(false);
  store.redo(); expect(store.getSnapshot().bundle.files.find((file) => file.path === TABLE_SOUND_PATH)?.content).toBe(soundText);
  const current = store.getSnapshot(); expect(store.applySceneCommand("Broken import", (draft) => attachSoundBundle(draft, "{}"))).toBe(false);
  expect(store.getSnapshot().draft.bundle).toEqual(current.draft.bundle);
  store.dispose(); projection.dispose();
});

test("combined release budget rejection leaves a previously valid game and backup unchanged", () => {
  const draft = normalizeEditorDraft(backup), content = "x".repeat(980_000);
  draft.bundle.files.push({ path: "runtime/large.json", content, byteLength: content.length, contentHash: soundHash(new TextEncoder().encode(content)) });
  const before = structuredClone(draft);
  expect(() => attachSoundBundle(draft, soundText)).toThrow("1 MiB");
  expect(draft).toEqual(before);
});
