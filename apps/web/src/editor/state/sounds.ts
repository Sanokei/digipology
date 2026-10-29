import { sha256 } from "digipology-canonical-json";
import { rawContentHash, UPLOAD_BODY_LIMIT } from "digipology-protocol/http";
import { TABLE_SOUND_PATH } from "digipology-protocol";
import { parseSoundBundle } from "../../audio/bundle";
import type { EditorDraft } from "./types";

/** Explicit released presentation asset; editor-only artwork/review metadata stays separate. */
export function attachSoundBundle(draft: EditorDraft, content: string): void {
  parseSoundBundle(content);
  const file = { path: TABLE_SOUND_PATH, content, byteLength: new TextEncoder().encode(content).length, contentHash: rawContentHash(content, sha256) };
  const files = [...draft.bundle.files], existing = files.findIndex((item) => item.path === TABLE_SOUND_PATH);
  if (existing < 0) files.push(file); else files[existing] = file;
  if (new TextEncoder().encode(JSON.stringify({ bundle: { ...draft.bundle, files } })).length > UPLOAD_BODY_LIMIT) throw new Error("These sounds would exceed the 1 MiB release budget. Use shorter clips or a smaller bundle; your game is preserved.");
  draft.bundle.files = files;
}
