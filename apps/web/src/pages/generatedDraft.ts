import { hashValue } from "digipology-canonical-json";
import { slugifyGameTitle, type AiGameDraftResponse, type ApiResult } from "digipology-protocol/http";
import type { ApiClient } from "../api/client";
import { importBundleAsDraft } from "../editor/state/bundle";
import { saveEditorDraft } from "../editor/state/persistence";
import type { EditorDraft, StorageLike } from "../editor/state/types";
import type { SavedRoomSession } from "../utils/roomSession";
import { inviteUrlForCode } from "../utils/inviteUrl";

export class DraftStorageError extends Error {
  constructor(cause: unknown) { super("Browser storage could not save this draft", { cause }); this.name = "DraftStorageError"; }
}

export function saveGeneratedDraft(storage: StorageLike, response: AiGameDraftResponse, prompt: string, id: string): EditorDraft {
  if (!response.validationReport.every((check) => check.ok) ||
    !response.validationReport.some((check) => check.check === "playability" && check.ok) ||
    response.qualityReport?.some((issue) => issue.severity === "error")) {
    throw new TypeError("The draft did not pass its playability checks");
  }
  const draft = importBundleAsDraft(JSON.stringify(response.draft), id);
  draft.tagline = prompt.trim().replaceAll(/\s+/g, " ").slice(0, 240);
  try { saveEditorDraft(storage, draft); }
  catch (error) { throw new DraftStorageError(error); }
  return draft;
}

/** The same authored version reuses its publication after a lost reply or room failure. */
export function generatedPublicationSlug(draft: EditorDraft): string {
  const suffix = hashValue({ id: draft.id, title: draft.title, tagline: draft.tagline, hash: draft.bundle.integrity.manifestHash }).slice(7, 19);
  return `${(slugifyGameTitle(draft.title) || "new-game").slice(0, 32)}-${suffix}`;
}

export async function publishDraftAndHost(client: ApiClient, draft: EditorDraft, origin: string): Promise<ApiResult<SavedRoomSession>> {
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
  const room = await client.createRoom({ releaseSlugOrId: game.latestReleaseId, visibility: "private" });
  if (!room.ok) return { ok: false, error: { ...room.error, message: `Your game is published, but the table could not open. Retry to open it without publishing another copy. ${room.error.message}` } };
  return { ok: true, value: { ...room.value, gameTitle: game.title, releaseId: game.latestReleaseId,
    inviteUrl: inviteUrlForCode(room.value.joinCode, origin) } };
}
