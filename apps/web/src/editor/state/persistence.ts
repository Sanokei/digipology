import { canonicalStringify } from "digipology-canonical-json";

import { normalizeEditorDraft } from "./bundle";
import type { DraftIndexEntry, EditorDraft, StorageLike } from "./types";

export const DRAFT_INDEX_KEY = "dgp.editor.index";
export const DRAFT_KEY_PREFIX = "dgp.editor.draft.";

export function draftStorageKey(id: string): string {
  return `${DRAFT_KEY_PREFIX}${encodeURIComponent(id)}`;
}

export function safeParse(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw) as unknown; }
  catch { return null; }
}

export function deserializeDraftIndex(
  raw: string | null,
  onSkip: (message: string) => void = () => undefined,
): DraftIndexEntry[] {
  const parsed = safeParse(raw);
  if (!Array.isArray(parsed)) return [];
  const result: DraftIndexEntry[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (
      typeof entry !== "object" || entry === null || Array.isArray(entry) ||
      (entry as Record<string, unknown>).version !== 1 ||
      typeof (entry as Record<string, unknown>).id !== "string" ||
      typeof (entry as Record<string, unknown>).title !== "string" ||
      typeof (entry as Record<string, unknown>).updatedAt !== "string"
    ) {
      onSkip(`Skipped invalid draft index entry ${index}.`);
      continue;
    }
    const candidate = entry as DraftIndexEntry;
    if (candidate.id === "" || seen.has(candidate.id)) {
      onSkip(`Skipped duplicate or empty draft index entry ${index}.`);
      continue;
    }
    seen.add(candidate.id);
    result.push({ ...candidate });
  }
  return result;
}

export function loadDraftIndex(storage: StorageLike): DraftIndexEntry[] {
  try { return deserializeDraftIndex(storage.getItem(DRAFT_INDEX_KEY), (message) => console.warn(message)); }
  catch (error) { console.warn("Local draft index is unavailable.", error); return []; }
}

export function serializeEditorDraft(draft: EditorDraft): string {
  return canonicalStringify(draft);
}

export function deserializeEditorDraft(raw: string | null): EditorDraft | null {
  const parsed = safeParse(raw);
  if (parsed === null) return null;
  try { return normalizeEditorDraft(parsed); }
  catch (error) {
    console.warn("Skipped invalid local editor draft.", error);
    return null;
  }
}

export function loadEditorDraft(storage: StorageLike, id: string): EditorDraft | null {
  try { return deserializeEditorDraft(storage.getItem(draftStorageKey(id))); }
  catch (error) { console.warn("Local editor drafts are unavailable.", error); return null; }
}

export function saveEditorDraft(storage: StorageLike, draft: EditorDraft): void {
  storage.setItem(draftStorageKey(draft.id), serializeEditorDraft(draft));
  const nextEntry: DraftIndexEntry = {
    version: 1,
    id: draft.id,
    title: draft.title,
    updatedAt: draft.updatedAt,
  };
  const index = loadDraftIndex(storage).filter((entry) => entry.id !== draft.id);
  index.push(nextEntry);
  index.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  storage.setItem(DRAFT_INDEX_KEY, canonicalStringify(index));
}

export function deleteEditorDraft(storage: StorageLike, id: string): void {
  storage.removeItem(draftStorageKey(id));
  const index = loadDraftIndex(storage).filter((entry) => entry.id !== id);
  storage.setItem(DRAFT_INDEX_KEY, canonicalStringify(index));
}
