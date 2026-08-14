import type { EditorDraft, HistoryFrame } from "../types";

export function createHistoryFrame(
  draft: EditorDraft,
  selectedEntityId: string | null,
  label: string,
  timestamp: string,
): HistoryFrame {
  return {
    label,
    draft: structuredClone(draft),
    selectedEntityId,
    timestamp,
  };
}
