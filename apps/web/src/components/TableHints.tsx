import { useEffect, useMemo, useState } from "react";

export type TableHintGesture = "drag" | "primary" | "actions";
export interface TableHintEvent { gesture: TableHintGesture; nonce: number }

const STORAGE_KEY = "digipology.tableHints.v1";
const ALL_HINTS: readonly TableHintGesture[] = ["drag", "primary", "actions"];

export function readCompletedTableHints(storage: Pick<Storage, "getItem"> | null): Set<TableHintGesture> {
  if (storage === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is TableHintGesture => ALL_HINTS.includes(value as TableHintGesture)) : []);
  } catch {
    return new Set();
  }
}

export function TableHints({ event, initialCompleted = [] }: { event: TableHintEvent | null; initialCompleted?: readonly TableHintGesture[] }) {
  const [completed, setCompleted] = useState<Set<TableHintGesture>>(() => new Set(initialCompleted));
  const [hydrated, setHydrated] = useState(false);
  const touch = useMemo(() => typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches, []);
  const current = ALL_HINTS.find((hint) => !completed.has(hint)) ?? null;

  useEffect(() => {
    setCompleted(readCompletedTableHints(typeof localStorage === "undefined" ? null : localStorage));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (event === null) return;
    setCompleted((previous) => {
      if (previous.has(event.gesture)) return previous;
      const next = new Set(previous).add(event.gesture);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* Storage may be unavailable. */ }
      return next;
    });
  }, [event]);
  useEffect(() => {
    if (!hydrated || current === null) return;
    const timer = setTimeout(() => {
      setCompleted((previous) => {
        const next = new Set(previous).add(current);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* Storage may be unavailable. */ }
        return next;
      });
    }, 12_000);
    return () => clearTimeout(timer);
  }, [current, hydrated]);

  if (current === null) return null;
  const copy: Record<TableHintGesture, string> = touch
    ? { drag: "Drag pieces", primary: "Two fingers move table", actions: "Hold for actions" }
    : { drag: "Drag to move", primary: "Double-click for primary action", actions: "Right-click for actions" };
  return <aside className="table-hints" aria-live="polite">
    <span>{copy[current]}</span>
    <button type="button" aria-label="Dismiss table hint" onClick={() => {
      const next = new Set(completed).add(current);
      setCompleted(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* Storage may be unavailable. */ }
    }}>×</button>
  </aside>;
}
