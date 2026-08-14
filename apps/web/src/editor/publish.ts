import { canonicalStringify } from "digipology-canonical-json";

import type { EditorCreateLocationState } from "../pages/createPrefill";
import type { EditorDraft } from "./state";

export function draftToCreatePrefill(draft: EditorDraft): EditorCreateLocationState {
  return { editorDraftPrefill: {
    title: draft.title,
    tagline: draft.tagline,
    slug: draft.slug,
    minPlayers: draft.minPlayers,
    maxPlayers: draft.maxPlayers,
    bundleText: canonicalStringify(draft.bundle),
  } };
}
