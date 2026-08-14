import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [onClose]);
  return createPortal(<div className="editor-context-menu" role="menu"
    style={{ left: Math.min(x, window.innerWidth - 226), top: Math.min(y, window.innerHeight - 150) }}
    onPointerDown={(event) => event.stopPropagation()}>{children}</div>, document.body);
}

export function ContextMenuItem({ children, onSelect, danger = false }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return <button role="menuitem" className={danger ? "is-danger" : undefined} type="button" onClick={onSelect}>{children}</button>;
}
