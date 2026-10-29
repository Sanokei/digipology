import { rebuildDraftIntegrity } from "./state/bundle";
import { saveEditorDraft, serializeEditorDraft } from "./state/persistence";
import type { EditorDraft, StorageLike } from "./state/types";

/** Rebuild the edited release, retaining all editor-only recovery metadata. */
export function editableDraftBackup(draft: EditorDraft): string {
  const current = structuredClone(draft);
  rebuildDraftIntegrity(current);
  return serializeEditorDraft(current);
}

/** Save synchronously before leaving the editor; autosave may still be pending. */
export function saveDraftForReview(storage: StorageLike, draft: EditorDraft): string {
  const current = structuredClone(draft);
  rebuildDraftIntegrity(current);
  saveEditorDraft(storage, current);
  return `/playtest/${encodeURIComponent(current.id)}`;
}
