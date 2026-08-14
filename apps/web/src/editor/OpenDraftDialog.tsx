import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { DraftIndexEntry } from "./state";

export type DraftDialogKeyResult =
  | { action: "none"; selectedIndex: number }
  | { action: "close"; selectedIndex: number }
  | { action: "open"; selectedIndex: number };

export function draftDialogKeyResult(key: string, selectedIndex: number, draftCount: number): DraftDialogKeyResult {
  if (key === "Escape") return { action: "close", selectedIndex };
  if (key === "Enter" && draftCount > 0) return { action: "open", selectedIndex };
  if (draftCount === 0) return { action: "none", selectedIndex: 0 };
  if (key === "ArrowDown") return { action: "none", selectedIndex: (selectedIndex + 1) % draftCount };
  if (key === "ArrowUp") return { action: "none", selectedIndex: (selectedIndex - 1 + draftCount) % draftCount };
  if (key === "Home") return { action: "none", selectedIndex: 0 };
  if (key === "End") return { action: "none", selectedIndex: draftCount - 1 };
  return { action: "none", selectedIndex };
}

export function OpenDraftDialog({
  drafts,
  onOpen,
  onClose,
}: {
  drafts: readonly DraftIndexEntry[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => (itemRefs.current[0] ?? dialogRef.current?.querySelector<HTMLButtonElement>("button"))?.focus());
    return () => previousFocus?.focus();
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (buttons.length === 0) return;
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === buttons.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      buttons[nextIndex]?.focus();
      return;
    }
    const result = draftDialogKeyResult(event.key, selectedIndex, drafts.length);
    if (result.action === "none" && result.selectedIndex === selectedIndex) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "close") onClose();
    else if (result.action === "open") {
      const draft = drafts[result.selectedIndex];
      if (draft !== undefined) onOpen(draft.id);
    } else {
      setSelectedIndex(result.selectedIndex);
      itemRefs.current[result.selectedIndex]?.focus();
    }
  };

  return <div className="editor-draft-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={dialogRef} className="editor-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-open-draft-title" onKeyDown={keyDown}>
      <header>
        <div><h2 id="editor-open-draft-title">Open local draft</h2><p>Choose a draft saved in this browser.</p></div>
        <button type="button" className="editor-draft-dialog__close" aria-label="Close draft picker" onClick={onClose}>×</button>
      </header>
      {drafts.length === 0 ? <p className="editor-draft-dialog__empty">No local drafts have been saved yet.</p> :
        <div className="editor-draft-dialog__list" role="listbox" aria-label="Local drafts">
          {drafts.map((draft, index) => <button
            ref={(element) => { itemRefs.current[index] = element; }}
            type="button"
            role="option"
            aria-selected={selectedIndex === index}
            className={selectedIndex === index ? "is-selected" : ""}
            key={draft.id}
            onFocus={() => setSelectedIndex(index)}
            onClick={() => onOpen(draft.id)}
          ><span><strong>{draft.title}</strong><small>{draft.id}</small></span><time dateTime={draft.updatedAt}>{draft.updatedAt}</time></button>)}
        </div>}
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
    </section>
  </div>;
}
