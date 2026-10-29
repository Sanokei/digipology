import { expect, test } from "bun:test";
import { rasterPng } from "../../../../../packages/protocol/src/raster.fixture";
import { normalizeArtworkCredits, type ReadyDraftArtwork } from "digipology-protocol";
import { artworkDataUrl, artworkHash, artworkPackage, normalizeDraftArtwork } from "./artwork";
import { createDiceGameEditorDraft } from "./bundle";
import { loadEditorDraft, saveEditorDraft, serializeEditorDraft } from "./persistence";

export function savedArtwork(): ReadyDraftArtwork {
  const bytes = rasterPng(4, 6);
  return { status: "ready", info: { formatVersion: 1, width: 4, height: 6, contentType: "image/png", sha256: artworkHash(bytes), credits: { artist: "Créateur", license: "Original", sourceUrl: "https://example.com/artwork" } }, dataUrl: artworkDataUrl(bytes, "image/png"), source: { name: "private-local-name.png", width: 4, height: 6, bytes: bytes.length } };
}

test("draft backups retain artwork and credits outside the unchanged playable bundle", () => {
  const draft = createDiceGameEditorDraft("artwork", "2026-10-29T00:00:00Z");
  draft.artwork = savedArtwork();
  draft.tagline = "Keep this authored tagline";
  draft.generationReview = { manifestHash: draft.bundle.integrity.manifestHash, warnings: [{ code: "game_win_unobserved", message: "Play it through" }] };
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  saveEditorDraft(store, draft);
  expect(loadEditorDraft(store, draft.id)).toMatchObject({ artwork: draft.artwork, tagline: draft.tagline, generationReview: draft.generationReview });
  expect(loadEditorDraft(store, draft.id)?.bundle).toEqual(draft.bundle);
  const backup = JSON.parse(serializeEditorDraft(draft));
  expect(backup.artwork.info.credits).toEqual(draft.artwork.info.credits);
  const publicPackage = artworkPackage(draft.artwork);
  expect(publicPackage).not.toContain("private-local-name");
  expect(normalizeDraftArtwork(JSON.parse(publicPackage).artwork)).toEqual({ status: "ready", info: draft.artwork.info, dataUrl: draft.artwork.dataUrl });
});

test("damaged bytes or mismatched dimensions become recoverable unavailable artwork with credits", () => {
  const artwork = savedArtwork();
  for (const bad of [{ ...artwork, dataUrl: artwork.dataUrl.slice(0, -12) }, { ...artwork, info: { ...artwork.info, width: 8, height: 12 } }, { ...artwork, info: { ...artwork.info, sha256: `sha256:${"0".repeat(64)}` } }, { ...artwork, info: { ...artwork.info, contentType: { toString: "invalid imported value" } } }]) {
    expect(normalizeDraftArtwork(bad)).toEqual({ status: "unavailable", credits: artwork.info.credits });
  }
  expect(normalizeDraftArtwork(undefined)).toBeUndefined();
  expect(normalizeArtworkCredits({ artist: "A", license: "B", sourceUrl: "javascript:alert(1)" })).toBeNull();
  expect(normalizeArtworkCredits({ artist: "A", license: "B", sourceUrl: "https://user:password@example.com/" })).toBeNull();
});
