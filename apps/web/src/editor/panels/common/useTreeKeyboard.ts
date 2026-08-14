import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

export interface TreeKeyboardState {
  focusId: string | null;
  typeahead: string;
  typeaheadAt: number;
}

export function nextTreeKeyboardState(
  state: TreeKeyboardState,
  event: { key: string; now: number },
  ids: readonly string[],
  labelFor: (id: string) => string,
): TreeKeyboardState {
  if (ids.length === 0) return { ...state, focusId: null };
  const index = state.focusId === null ? -1 : Math.max(0, ids.indexOf(state.focusId));
  if (event.key === "ArrowDown") return { ...state, focusId: ids[Math.min(ids.length - 1, index + 1)]! };
  if (event.key === "ArrowUp") return { ...state, focusId: ids[Math.max(0, index - 1)]! };
  if (event.key === "Home") return { ...state, focusId: ids[0]! };
  if (event.key === "End") return { ...state, focusId: ids.at(-1)! };
  if (event.key.length === 1 && /\S/.test(event.key)) {
    const prefix = event.now - state.typeaheadAt > 700 ? event.key : `${state.typeahead}${event.key}`;
    const lowered = prefix.toLowerCase();
    const ordered = [...ids.slice(index + 1), ...ids.slice(0, index + 1)];
    const match = ordered.find((id) => labelFor(id).toLowerCase().startsWith(lowered));
    return { focusId: match ?? state.focusId, typeahead: prefix, typeaheadAt: event.now };
  }
  return state;
}

export function useTreeKeyboard({
  ids,
  selectedId,
  labelFor,
  onSelect,
  onRename,
  onDelete,
  onDuplicate,
}: {
  ids: readonly string[];
  selectedId: string | null;
  labelFor: (id: string) => string;
  onSelect: (id: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const state = useRef<TreeKeyboardState>({ focusId: selectedId, typeahead: "", typeaheadAt: 0 });
  state.current.focusId = selectedId ?? state.current.focusId;
  return (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault(); onDuplicate(); return;
    }
    if (event.key === "Delete") { event.preventDefault(); onDelete(); return; }
    if (event.key === "F2") { event.preventDefault(); onRename(); return; }
    const next = nextTreeKeyboardState(state.current, { key: event.key, now: Date.now() }, ids, labelFor);
    if (next !== state.current) {
      state.current = next;
      if (next.focusId !== null && next.focusId !== selectedId) onSelect(next.focusId);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.key.length === 1) event.preventDefault();
    }
  };
}
