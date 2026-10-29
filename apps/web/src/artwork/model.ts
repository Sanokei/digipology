import type { ReadyDraftArtwork, ArtPurpose, ArtJobKey, GameArtDirection, ArtworkGeneration, GeneratedArtwork, ArtworkDraftReview } from "digipology-protocol";
import type { ApiResult, ReleaseBundleDto } from "digipology-protocol/http";
import type { EditorDraft } from "../editor/state/types";
import type { CanonicalGameState } from "digipology-kernel";
import { CARD_BACK_PATH, readCardBackArtwork } from "../scene/cardBack";
import { attachCardBack } from "../editor/state/cardBack";
import { rebuildDraftIntegrity } from "../editor/state/bundle";
export type { ArtPurpose, ArtJobKey, GameArtDirection, ArtworkGeneration, ArtworkGenerationJob, GeneratedArtwork } from "digipology-protocol";
export type ArtworkDraft = EditorDraft;
export type ArtworkReviewResult = ArtworkDraftReview;
export interface ArtworkApi {
  generateArtDirection(input: { title: string; rulebook: string }): Promise<ApiResult<GameArtDirection>>;
  generateDraftArtwork(input: { draftId: string; title: string; purpose: ArtPurpose; direction: GameArtDirection; revision: number }): Promise<ApiResult<GeneratedArtwork>>;
  reviewArtworkDraft?(bundle: ReleaseBundleDto): Promise<ApiResult<ArtworkReviewResult>>;
}
export interface PreparedResult { original: GeneratedArtwork; artwork: ReadyDraftArtwork }
export const ART_PURPOSES: readonly ArtPurpose[] = ["cover", "card-back"];
export const jobKey = (purpose: ArtPurpose): ArtJobKey => purpose === "cover" ? "cover" : "cardBack";
export const purposeLabel = (purpose: ArtPurpose): string => purpose === "cover" ? "Cover" : "Card back";

export function artworkScope(draft: EditorDraft) {
  const entities = Object.values((draft.bundle.initialSnapshot.state as CanonicalGameState).entities);
  const decks = entities.filter((entity) => entity.components.deck !== undefined).length;
  return { needsBack: decks > 0 || entities.some((entity) => entity.components.card !== undefined), multipleDecks: decks > 1 };
}

export function initialArtworkGeneration(draft: EditorDraft): ArtworkGeneration {
  const cover = selectedDraftImage(draft, "cover"), back = selectedDraftImage(draft, "card-back");
  return { version: 1, sourceManifestHash: draft.bundle.integrity.manifestHash, direction: null,
    jobs: { cover: { status: cover ? "ready" : "pending", revision: 0, ...(cover ? { outputSha256: cover.info.sha256 } : {}) },
      cardBack: { status: back ? "ready" : artworkScope(draft).needsBack ? "pending" : "not-needed", revision: 0, ...(back ? { outputSha256: back.info.sha256 } : {}) } } };
}

export function selectedDraftImage(draft: EditorDraft, purpose: ArtPurpose): ReadyDraftArtwork | undefined {
  if (purpose === "cover") return draft.artwork?.status === "ready" ? draft.artwork : undefined;
  const content = draft.bundle.files.find((file) => file.path === CARD_BACK_PATH)?.content;
  try { return content ? readCardBackArtwork(content) : undefined; } catch { return undefined; }
}

/** A broken saved selection requires a deliberate repair, never an auto-overwrite. */
export function canResumeArtwork(draft: EditorDraft, purpose: ArtPurpose): boolean {
  return purpose !== "cover" || draft.artwork?.status !== "unavailable";
}

/** Also used for an editable backup when browser storage rejects a manual edit. */
export function withManualArtwork(draft: ArtworkDraft, purpose: ArtPurpose, artwork: ReadyDraftArtwork | undefined): ArtworkDraft {
  if (!artwork && purpose !== "cover") throw new Error("Choose a complete image for this game’s card backs.");
  const next = structuredClone(draft);
  next.artworkGeneration ??= initialArtworkGeneration(next);
  const job = next.artworkGeneration.jobs[jobKey(purpose)];
  job.revision += 1;
  delete job.message; delete job.failureKind; delete job.assetId; delete job.selectedAssetId; delete job.originalSha256; delete job.outputSha256;
  if (artwork) { job.status = "ready"; job.outputSha256 = artwork.info.sha256; }
  else { job.status = "failed"; job.message = "No cover selected. Replace it or retry to create one."; }
  if (purpose === "cover") {
    if (artwork) next.artwork = artwork;
    else delete next.artwork;
  } else {
    attachCardBack(next, artwork); rebuildDraftIntegrity(next);
    next.artworkGeneration.reviewManifestHash = next.bundle.integrity.manifestHash;
  }
  return next;
}

export function artworkJobsReady(draft: EditorDraft): boolean {
  const generation = draft.artworkGeneration;
  return !!generation && ART_PURPOSES.every((purpose) => {
    const job = generation.jobs[jobKey(purpose)];
    if (job.status === "not-needed") return purpose === "card-back" && !artworkScope(draft).needsBack;
    const selected = selectedDraftImage(draft, purpose);
    return job.status === "ready" && !!selected && job.outputSha256 === selected.info.sha256;
  });
}

export function artworkNeedsAutomaticReview(draft: EditorDraft): boolean {
  return artworkJobsReady(draft) && draft.artworkGeneration?.reviewManifestHash === draft.bundle.integrity.manifestHash &&
    draft.generationReview?.manifestHash !== draft.bundle.integrity.manifestHash;
}
