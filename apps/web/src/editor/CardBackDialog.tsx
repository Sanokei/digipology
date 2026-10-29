import type { DraftArtwork, ReadyDraftArtwork } from "digipology-protocol";
import { ArtworkDialog } from "../components/ArtworkDialog";
import { CARD_BACK_PATH, readCardBackArtwork } from "../scene/cardBack";
import type { EditorDraft } from "./state";

export function CardBackDialog({ draft, onSave, onClose }: { draft: EditorDraft; onSave(artwork: ReadyDraftArtwork | undefined): void; onClose(): void }) {
  const content = draft.bundle.files.find((file) => file.path === CARD_BACK_PATH)?.content;
  let artwork: DraftArtwork | undefined;
  if (content) { try { artwork = readCardBackArtwork(content); } catch { artwork = { status: "unavailable" }; } }
  return <ArtworkDialog title={draft.title} purpose="card-back" {...(artwork ? { artwork } : {})} onClose={onClose} onSave={async (next) => {
    if (next && next.status !== "ready") throw new Error("Choose a complete card-back image.");
    onSave(next);
  }} />;
}
