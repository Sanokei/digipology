import { sha256 } from "digipology-canonical-json";
import type { ReadyDraftArtwork } from "digipology-protocol";
import { rawContentHash, UPLOAD_BODY_LIMIT } from "digipology-protocol/http";
import { CARD_BACK_PATH, cardBackPackage } from "../../scene/cardBack";
import type { EditorDraft } from "./types";

export function attachCardBack(draft: EditorDraft, artwork: ReadyDraftArtwork | undefined): void {
  const files = [...draft.bundle.files], existing = files.findIndex((file) => file.path === CARD_BACK_PATH);
  if (artwork) {
    const content = cardBackPackage(artwork);
    const file = { path: CARD_BACK_PATH, content, contentHash: rawContentHash(content, sha256), byteLength: new TextEncoder().encode(content).length };
    if (existing < 0) files.push(file); else files[existing] = file;
  } else if (existing >= 0) files.splice(existing, 1);
  if (new TextEncoder().encode(JSON.stringify({ bundle: { ...draft.bundle, files } })).length > UPLOAD_BODY_LIMIT) throw new Error("This card back would exceed the 1 MiB game budget. Choose a smaller image; your game is preserved.");
  draft.bundle.files = files;
}
