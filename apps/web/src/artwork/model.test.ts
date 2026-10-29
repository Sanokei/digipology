import { expect, test } from "bun:test";
import type { ReadyDraftArtwork } from "digipology-protocol";
import { rasterPng } from "../../../../packages/protocol/src/raster.fixture";
import { artworkDataUrl, artworkHash } from "../editor/state/artworkData";
import { createCardGameEditorDraft, createDiceGameEditorDraft, rebuildDraftIntegrity } from "../editor/state/bundle";
import { attachCardBack } from "../editor/state/cardBack";
import { updateScript } from "../editor/state/scripts";
import { artworkJobsReady, artworkNeedsAutomaticReview, canResumeArtwork, initialArtworkGeneration, selectedDraftImage, withManualArtwork } from "./model";

function localRaster(width: number, height: number): ReadyDraftArtwork {
  const bytes = rasterPng(width, height);
  return { status: "ready", dataUrl: artworkDataUrl(bytes, "image/png"), info: { formatVersion: 1, contentType: "image/png", width, height, sha256: artworkHash(bytes), credits: { artist: "Local serialization fixture", license: "Test", sourceUrl: "" } } };
}

test("legacy manually selected cover and distinct back remain selected when generation metadata is added", () => {
  const draft = createCardGameEditorDraft("existing-manual", "2026-10-29T00:00:00.000Z");
  draft.artwork = localRaster(4, 6);
  const back = localRaster(6, 9);
  attachCardBack(draft, back); rebuildDraftIntegrity(draft);
  const state = structuredClone(draft.bundle.initialSnapshot);
  draft.artworkGeneration = initialArtworkGeneration(draft);
  expect(artworkJobsReady(draft)).toBe(true);
  expect(selectedDraftImage(draft, "cover")?.info.sha256).toBe(draft.artwork.info.sha256);
  expect(selectedDraftImage(draft, "card-back")?.info.sha256).toBe(back.info.sha256);
  expect(draft.bundle.initialSnapshot).toEqual(state);
});

test("a prior image does not count as a finished replacement or stand in for missing selected bytes", () => {
  const draft = createDiceGameEditorDraft("pending-image", "2026-10-29T00:00:00.000Z");
  draft.artwork = localRaster(4, 6); draft.artworkGeneration = initialArtworkGeneration(draft);
  expect(draft.artworkGeneration.jobs.cardBack.status).toBe("not-needed");
  expect(artworkJobsReady(draft)).toBe(true);
  draft.artworkGeneration.jobs.cover.status = "failed";
  expect(artworkJobsReady(draft)).toBe(false);
  draft.artworkGeneration.jobs.cover.status = "ready";
  delete draft.artwork;
  expect(artworkJobsReady(draft)).toBe(false);
});

test("artwork completion checks its exact manifest without launching checks on every unrelated rule edit", () => {
  const draft = createCardGameEditorDraft("art-check-scope", "2026-10-29T00:00:00.000Z");
  draft.artwork = localRaster(4, 6); attachCardBack(draft, localRaster(6, 9)); rebuildDraftIntegrity(draft);
  draft.artworkGeneration = initialArtworkGeneration(draft);
  expect(artworkNeedsAutomaticReview(draft)).toBe(false);
  draft.artworkGeneration.reviewManifestHash = draft.bundle.integrity.manifestHash;
  expect(artworkNeedsAutomaticReview(draft)).toBe(true);
  const file = draft.bundle.files.find((file) => file.path.endsWith(".lua"))!;
  updateScript(draft, file.path, file.content + "\n-- User is still editing rules");
  rebuildDraftIntegrity(draft);
  expect(artworkNeedsAutomaticReview(draft)).toBe(false);
});

test("a damaged saved cover blocks automatic replacement while other pending art may resume", () => {
  const draft = createCardGameEditorDraft("repair-cover", "2026-10-29T00:00:00.000Z");
  draft.artwork = { status: "unavailable", credits: { artist: "Original artist", license: "Owned", sourceUrl: "" } };
  draft.artworkGeneration = initialArtworkGeneration(draft);
  expect(canResumeArtwork(draft, "cover")).toBe(false);
  expect(canResumeArtwork(draft, "card-back")).toBe(true);
  expect(artworkJobsReady(draft)).toBe(false);
});

test("manual cover replacement and removal preserve gameplay, credits, back and previous immutable draft", () => {
  const draft = createCardGameEditorDraft("manual-backup", "2026-10-29T00:00:00.000Z");
  const back = localRaster(6, 9); attachCardBack(draft, back); rebuildDraftIntegrity(draft);
  const original = structuredClone(draft), cover = localRaster(4, 6);
  const replaced = withManualArtwork(draft, "cover", cover);
  expect(draft).toEqual(original);
  expect(replaced.bundle).toEqual(original.bundle);
  expect(replaced.artwork).toEqual(cover);
  expect(selectedDraftImage(replaced, "card-back")).toEqual(back);
  expect(artworkJobsReady(replaced)).toBe(true);
  const removed = withManualArtwork(replaced, "cover", undefined);
  expect(removed.artwork).toBeUndefined();
  expect(removed.artworkGeneration?.jobs.cover).toMatchObject({ status: "failed", message: expect.stringContaining("No cover selected") });
  expect(removed.artworkGeneration?.jobs.cover.outputSha256).toBeUndefined();
  expect(removed.bundle).toEqual(original.bundle);
  expect(() => withManualArtwork(replaced, "card-back", undefined)).toThrow("complete image");
});
