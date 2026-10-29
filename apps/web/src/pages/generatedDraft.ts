import { hashValue } from "digipology-canonical-json";
import { slugifyGameTitle, type AiGameDraftResponse, type ApiResult } from "digipology-protocol/http";
import type { ApiClient } from "../api/client";
import { importBundleAsDraft } from "../editor/state/bundle";
import { saveEditorDraft } from "../editor/state/persistence";
import type { EditorDraft, StorageLike } from "../editor/state/types";
import type { SavedRoomSession } from "../utils/roomSession";
import { inviteUrlForCode } from "../utils/inviteUrl";
import { artworkBlob, verifyArtwork } from "../editor/state/artwork";

export class DraftStorageError extends Error {
  constructor(cause: unknown) { super("Browser storage could not save this draft", { cause }); this.name = "DraftStorageError"; }
}

export function createGeneratedDraft(response: AiGameDraftResponse, prompt: string, id: string): EditorDraft {
  if (!response.validationReport.every((check) => check.ok) ||
    !response.validationReport.some((check) => check.check === "playability" && check.ok) ||
    response.qualityReport?.some((issue) => issue.severity === "error")) {
    throw new TypeError("The draft did not pass its playability checks");
  }
  const draft = importBundleAsDraft(JSON.stringify(response.draft), id);
  draft.tagline = (response.tagline?.trim() || prompt.trim()).replaceAll(/\s+/g, " ").slice(0, 240);
  draft.generationReview = { manifestHash: draft.bundle.integrity.manifestHash,
    warnings: (response.qualityReport ?? []).filter((issue) => issue.severity === "warning").slice(0, 256).map((issue) => ({ code: issue.code.slice(0, 80), message: issue.message.slice(0, 2_000) })) };
  return draft;
}

export function saveGeneratedDraft(storage: StorageLike, response: AiGameDraftResponse, prompt: string, id: string): EditorDraft {
  const draft = createGeneratedDraft(response, prompt, id);
  try { saveEditorDraft(storage, draft); }
  catch (error) { throw new DraftStorageError(error); }
  return draft;
}

/** The same authored version reuses its publication after a lost reply or room failure. */
export function generatedPublicationSlug(draft: EditorDraft): string {
  const suffix = hashValue({ id: draft.id, title: draft.title, tagline: draft.tagline, hash: draft.bundle.integrity.manifestHash }).slice(7, 19);
  return `${(slugifyGameTitle(draft.title) || "new-game").slice(0, 32)}-${suffix}`;
}

export async function publishDraftAndHost(client: ApiClient, draft: EditorDraft, origin: string, verify = verifyArtwork): Promise<ApiResult<SavedRoomSession>> {
  if (draft.artwork) {
    try {
      if (draft.artwork.status !== "ready") throw new Error("Replace or remove the unreadable artwork before publishing.");
      await verify(draft.artwork);
    } catch (error) { return { ok: false, error: { code: "invalid_artwork", message: error instanceof Error ? error.message : "The artwork could not be opened." } }; }
  }
  const slug = generatedPublicationSlug(draft);
  const library = await client.listMyGames();
  if (!library.ok) return library;
  let game = library.value.games.find((candidate) => candidate.slug === slug);
  if (!game) {
    const published = await client.createGame({ title: draft.title, tagline: draft.tagline, slug,
      minPlayers: draft.minPlayers, maxPlayers: draft.maxPlayers, bundle: draft.bundle });
    if (!published.ok) return published;
    game = published.value.game;
  }
  if (draft.artwork?.status === "ready") {
    // A lost upload reply must reuse the committed image and its credit revision.
    const current = game.coverVersion == null ? null : await client.getCoverInfo(game.slug, game.coverVersion);
    if (!current?.ok || !current.value.artwork || hashValue(current.value.artwork) !== hashValue(draft.artwork.info)) {
      const uploaded = await client.uploadCover(game.slug, artworkBlob(draft.artwork), draft.artwork.info.credits);
      if (!uploaded.ok) return { ok: false, error: { ...uploaded.error, message: `Your game is published, but its artwork could not be saved. Retry to finish without publishing another copy. ${uploaded.error.message}` } };
    }
  }
  const room = await client.createRoom({ releaseSlugOrId: game.latestReleaseId, visibility: "private" });
  if (!room.ok) return { ok: false, error: { ...room.error, message: `Your game is published, but the table could not open. Retry to open it without publishing another copy. ${room.error.message}` } };
  return { ok: true, value: { ...room.value, gameTitle: game.title, releaseId: game.latestReleaseId,
    inviteUrl: inviteUrlForCode(room.value.joinCode, origin) } };
}
