import { artworkScope } from "../artwork/model";
import { CARD_DESIGNS_PATH, parseCardDesigns } from "digipology-protocol";
import { sha256 } from "digipology-canonical-json";
import { hashValue } from "digipology-canonical-json";
import { slugifyGameTitle, type AiGameDraftResponse, type AiRuleSource, type ApiResult } from "digipology-protocol/http";
import type { ApiClient } from "../api/client";
import { importBundleAsDraft } from "../editor/state/bundle";
import { saveEditorDraft } from "../editor/state/persistence";
import type { EditorDraft, StorageLike } from "../editor/state/types";
import type { SavedRoomSession } from "../utils/roomSession";
import { inviteUrlForCode } from "../utils/inviteUrl";
import { generationRequest } from "./ruleSources";
import { artworkBlob, verifyArtwork } from "../editor/state/artwork";
import type { CanonicalGameState } from "digipology-kernel";
import { normalizeGameArtDirection, normalizeArtworkGeneration } from "digipology-protocol";

export type DraftPublicationStage = "publication" | "artwork" | "table";
export type DraftPublicationResult = Extract<ApiResult<SavedRoomSession>, { ok: true }>
  | (Extract<ApiResult<never>, { ok: false }> & { stage: DraftPublicationStage });

export class DraftStorageError extends Error {
  constructor(cause: unknown) { super("Browser storage could not save this draft", { cause }); this.name = "DraftStorageError"; }
}

export function createGeneratedDraft(response: AiGameDraftResponse, prompt: string, id: string, references: readonly AiRuleSource[] = []): EditorDraft {
  if (!response.validationReport.every((check) => check.ok) ||
    !response.validationReport.some((check) => check.check === "playability" && check.ok) ||
    response.qualityReport?.some((issue) => issue.severity === "error")) {
    throw new TypeError("The draft did not pass its playability checks");
  }
  const draft = importBundleAsDraft(JSON.stringify(response.draft), id);
  draft.tagline = (response.tagline?.trim() || prompt.trim()).replaceAll(/\s+/g, " ").slice(0, 240);
  draft.generationReview = { manifestHash: draft.bundle.integrity.manifestHash,
    warnings: (response.qualityReport ?? []).filter((issue) => issue.severity === "warning").slice(0, 256).map((issue) => ({ code: issue.code.slice(0, 80), message: issue.message.slice(0, 2_000) })) };
  if (references.length) draft.generationRequest = generationRequest(prompt, references);
  if (Object.prototype.hasOwnProperty.call(response, "artDirection")) {
    const direction = response.artDirection == null ? null : normalizeGameArtDirection(response.artDirection);
    if (response.artDirection != null && !direction) throw new TypeError("The returned art direction is unreadable; keep the accepted rules and retry artwork.");
    const hasCards = artworkScope(draft).needsBack;
    draft.artworkGeneration = { version: 1, sourceManifestHash: draft.bundle.integrity.manifestHash, direction,
      jobs: { cover: { status: "pending", revision: 0 }, cardBack: { status: hasCards ? "pending" : "not-needed", revision: 0 } } };
  }
  if (response.cardArtBriefs?.length) {
    draft.artworkGeneration ??= { version: 1, sourceManifestHash: draft.bundle.integrity.manifestHash, direction: null, jobs: { cover: { status: "pending", revision: 0 }, cardBack: { status: "pending", revision: 0 } } };
    draft.artworkGeneration.cardJobs = response.cardArtBriefs.map((brief) => ({ ...brief, job: { status: "pending", revision: 0 } }));
  }
  if (draft.artworkGeneration) { const checked = normalizeArtworkGeneration(draft.artworkGeneration); if (!checked) throw new Error("The card image job plan is invalid. Keep the rules and retry the image plan."); draft.artworkGeneration = checked; }
  return draft;
}

export function saveGeneratedDraft(storage: StorageLike, response: AiGameDraftResponse, prompt: string, id: string, references: readonly AiRuleSource[] = []): EditorDraft {
  const draft = createGeneratedDraft(response, prompt, id, references);
  try { saveEditorDraft(storage, draft); }
  catch (error) { throw new DraftStorageError(error); }
  return draft;
}

/** The same authored version reuses its publication after a lost reply or room failure. */
export function generatedPublicationSlug(draft: EditorDraft): string {
  const suffix = hashValue({ id: draft.id, title: draft.title, tagline: draft.tagline, hash: draft.bundle.integrity.manifestHash }).slice(7, 19);
  return `${(slugifyGameTitle(draft.title) || "new-game").slice(0, 32)}-${suffix}`;
}

export async function publishDraftAndHost(client: ApiClient, draft: EditorDraft, origin: string, verify = verifyArtwork): Promise<DraftPublicationResult> {
  try {
    const content = draft.bundle.files.find((file) => file.path === CARD_DESIGNS_PATH)?.content;
    if (content) for (const asset of parseCardDesigns(content, sha256).assets) await verify(asset.artwork);
  } catch (error) { return { ok: false, stage: "artwork", error: { code: "invalid_card_artwork", message: error instanceof Error ? error.message : "Replace or remove damaged card artwork before publishing." } }; }
  if (draft.artwork) {
    try {
      if (draft.artwork.status !== "ready") throw new Error("Replace or remove the unreadable artwork before publishing.");
      await verify(draft.artwork);
    } catch (error) { return { ok: false, stage: "artwork", error: { code: "invalid_artwork", message: error instanceof Error ? error.message : "The artwork could not be opened." } }; }
  }
  const slug = generatedPublicationSlug(draft);
  const library = await client.listMyGames();
  if (!library.ok) return { ...library, stage: "publication" };
  let game = library.value.games.find((candidate) => candidate.slug === slug);
  if (!game) {
    const published = await client.createGame({ title: draft.title, tagline: draft.tagline, slug,
      minPlayers: draft.minPlayers, maxPlayers: draft.maxPlayers, bundle: draft.bundle });
    if (!published.ok) return { ...published, stage: "publication" };
    game = published.value.game;
  }
  if (draft.artwork?.status === "ready") {
    // A lost upload reply must reuse the committed image and its credit revision.
    const current = game.coverVersion == null ? null : await client.getCoverInfo(game.slug, game.coverVersion);
    if (!current?.ok || !current.value.artwork || hashValue(current.value.artwork) !== hashValue(draft.artwork.info)) {
      const uploaded = await client.uploadCover(game.slug, artworkBlob(draft.artwork), draft.artwork.info.credits, draft.artwork.info.generation);
      if (!uploaded.ok) return { ok: false, stage: "artwork", error: { ...uploaded.error, message: `Your game is published, but its artwork could not be saved. Retry to finish without publishing another copy. ${uploaded.error.message}` } };
    }
  }
  const room = await client.createRoom({ releaseSlugOrId: game.latestReleaseId, visibility: "private" });
  if (!room.ok) return { ok: false, stage: "table", error: { ...room.error, message: `Your game is published, but the table could not open. Retry to open it without publishing another copy. ${room.error.message}` } };
  return { ok: true, value: { ...room.value, gameTitle: game.title, releaseId: game.latestReleaseId,
    inviteUrl: inviteUrlForCode(room.value.joinCode, origin) } };
}
