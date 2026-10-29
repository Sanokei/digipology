import { expect, test } from "bun:test";
import { UPLOAD_BODY_LIMIT } from "digipology-protocol/http";
import { EditorStore } from "./EditorStore";
import { attachCardBack } from "./cardBack";
import { exportBundleText, importBundleAsDraft, normalizeEditorDraft } from "./bundle";
import { deserializeEditorDraft, serializeEditorDraft } from "./persistence";
import { CARD_BACK_PATH, cardBackForGame, readCardBackArtwork } from "../../scene/cardBack";
import { KernelStore } from "../../state/kernelStore";

const backup = await Bun.file(new URL("../../../../../e2e/fixtures/raster-draft.editor.json", import.meta.url)).json();

test("a game-specific raster back survives release/backup round trips and undo without changing rules, cover or canonical state", () => {
  const original = normalizeEditorDraft(backup), artwork = original.artwork;
  if (artwork?.status !== "ready") throw new Error("Raster fixture missing");
  const store = new EditorStore(original, { saveDraft: () => {} });
  expect(store.applySceneCommand("Card back", (draft) => attachCardBack(draft, artwork))).toBe(true);
  const edited = store.getSnapshot().draft, file = edited.bundle.files.find((file) => file.path === CARD_BACK_PATH)!;
  expect(edited.bundle.initialSnapshot).toEqual(original.bundle.initialSnapshot);
  expect(edited.bundle.files.filter((f) => f.path !== CARD_BACK_PATH)).toEqual(original.bundle.files);
  expect(edited.bundle.integrity.manifestHash).not.toBe(original.bundle.integrity.manifestHash);
  expect(edited.artwork).toEqual(original.artwork); expect(edited.generationReview).toEqual(original.generationReview);
  const publicBack = readCardBackArtwork(file.content);
  expect(publicBack.dataUrl).toBe(artwork.dataUrl); expect(publicBack.info).toEqual(artwork.info); expect(publicBack.source).toBeUndefined();
  const restored = deserializeEditorDraft(serializeEditorDraft(edited))!;
  expect(restored.bundle).toEqual(edited.bundle);
  const exported = exportBundleText(edited), imported = importBundleAsDraft(exported, "back-roundtrip");
  expect(JSON.parse(exported).artwork).toBeUndefined();
  expect(imported.bundle.files.find((f) => f.path === CARD_BACK_PATH)?.content).toBe(file.content);
  const projection = new KernelStore(); projection.loadRelease(imported.bundle);
  expect(projection.getSnapshot().cardBackBundle).toBe(file.content);
  expect(projection.confirmedSnapshot() as unknown).toEqual(original.bundle.initialSnapshot);
  store.undo(); expect(store.getSnapshot().bundle.files.some((f) => f.path === CARD_BACK_PATH)).toBe(false);
  store.redo(); expect(store.getSnapshot().bundle.files.find((f) => f.path === CARD_BACK_PATH)?.content).toBe(file.content);
  const damaged = JSON.parse(file.content); damaged.artwork.info.sha256 = `sha256:${"0".repeat(64)}`;
  expect(() => readCardBackArtwork(JSON.stringify(damaged))).toThrow("damaged");
  expect(cardBackForGame(edited.title, JSON.stringify(damaged))).toMatchObject({ issue: expect.stringContaining("damaged") });
  expect(cardBackForGame("First Deal", null, "builtin_first_deal_2").src).not.toBe(cardBackForGame("Dice Dash", null, "builtin_dice_dash_3").src);
  expect(cardBackForGame("First Deal", null, "custom_first_deal")).toMatchObject({ src: "", pending: true });
  expect(cardBackForGame(edited.title, file.content).src).toBe(artwork.dataUrl);
  store.dispose(); projection.dispose();
});

test("combined budget failure preserves a valid draft before replacing its back", () => {
  const draft = normalizeEditorDraft(backup), artwork = draft.artwork;
  if (artwork?.status !== "ready") throw new Error("Raster fixture missing");
  const available = UPLOAD_BODY_LIMIT - new TextEncoder().encode(JSON.stringify({ bundle: draft.bundle })).length - 2000;
  draft.bundle.files.push({ path: "runtime/large.json", content: "x".repeat(available), byteLength: available, contentHash: "sha256:" + "0".repeat(64) });
  expect(new TextEncoder().encode(JSON.stringify({ bundle: draft.bundle })).length).toBeLessThan(UPLOAD_BODY_LIMIT);
  const before = structuredClone(draft);
  expect(() => attachCardBack(draft, artwork)).toThrow("1 MiB");
  expect(draft).toEqual(before);
});
