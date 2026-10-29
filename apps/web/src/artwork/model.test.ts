import { expect, test } from "bun:test";
import type { ReadyDraftArtwork } from "digipology-protocol";
import { rasterPng } from "../../../../packages/protocol/src/raster.fixture";
import { artworkDataUrl, artworkHash } from "../editor/state/artworkData";
import { createCardGameEditorDraft, createDiceGameEditorDraft, rebuildDraftIntegrity } from "../editor/state/bundle";
import { attachCardBack } from "../editor/state/cardBack";
import { artworkJobsReady, artworkNeedsAutomaticReview, initialArtworkGeneration, selectedDraftImage } from "./model";

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
  draft.bundle.files.find((file) => file.path.endsWith(".lua"))!.content += "\n-- User is still editing rules";
  rebuildDraftIntegrity(draft);
  expect(artworkNeedsAutomaticReview(draft)).toBe(false);
});
