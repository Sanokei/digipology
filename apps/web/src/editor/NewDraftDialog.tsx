import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { EDITOR_TEMPLATES, type EditorTemplateId } from "./state";

export type NewDraftDialogKeyResult =
  | { action: "none"; selectedIndex: number }
  | { action: "close"; selectedIndex: number }
  | { action: "choose"; selectedIndex: number };

export function newDraftDialogKeyResult(
  key: string,
  selectedIndex: number,
  templateCount = EDITOR_TEMPLATES.length,
): NewDraftDialogKeyResult {
  if (key === "Escape") return { action: "close", selectedIndex };
  if (key === "Enter" || key === " ") return { action: "choose", selectedIndex };
  if (key === "ArrowRight" || key === "ArrowDown") {
    return { action: "none", selectedIndex: (selectedIndex + 1) % templateCount };
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return { action: "none", selectedIndex: (selectedIndex - 1 + templateCount) % templateCount };
  }
  if (key === "Home") return { action: "none", selectedIndex: 0 };
  if (key === "End") return { action: "none", selectedIndex: templateCount - 1 };
  return { action: "none", selectedIndex };
}

export function NewDraftDialog({
  onChoose,
  onClose,
}: {
  onChoose: (templateId: EditorTemplateId) => void;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => itemRefs.current[0]?.focus());
    return () => previousFocus?.focus();
  }, []);

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey
        ? (current <= 0 ? buttons.length - 1 : current - 1)
        : (current < 0 || current === buttons.length - 1 ? 0 : current + 1);
      event.preventDefault();
      buttons[next]?.focus();
      return;
    }
    const result = newDraftDialogKeyResult(event.key, selectedIndex);
    if (result.action === "none" && result.selectedIndex === selectedIndex) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "close") onClose();
    else if (result.action === "choose") {
      const template = EDITOR_TEMPLATES[result.selectedIndex];
      if (template !== undefined) onChoose(template.id);
    } else {
      setSelectedIndex(result.selectedIndex);
      itemRefs.current[result.selectedIndex]?.focus();
    }
  };

  return <div className="editor-draft-dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={dialogRef} className="editor-draft-dialog editor-template-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-new-draft-title" onKeyDown={keyDown}>
      <header>
        <div><h2 id="editor-new-draft-title">New draft</h2><p>Choose a playable starting table. Everything stays editable.</p></div>
        <button type="button" className="editor-draft-dialog__close" aria-label="Close template picker" onClick={onClose}>×</button>
      </header>
      <div className="editor-template-dialog__grid" role="listbox" aria-label="Starter templates">
        {EDITOR_TEMPLATES.map((template, index) => <button
          ref={(element) => { itemRefs.current[index] = element; }}
          type="button"
          role="option"
          aria-selected={selectedIndex === index}
          className={selectedIndex === index ? "is-selected" : ""}
          key={template.id}
          onFocus={() => setSelectedIndex(index)}
          onClick={() => onChoose(template.id)}
        ><strong>{template.title}</strong><span>{template.description}</span></button>)}
      </div>
      <footer><span><kbd>Arrow keys</kbd> Select</span><span><kbd>Enter</kbd> Create</span><span><kbd>Esc</kbd> Close</span></footer>
    </section>
  </div>;
}
