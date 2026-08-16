import { useEffect, useRef } from "react";

export interface ObjectContextMenuAction {
  id: string;
  label: string;
  disabled?: boolean;
  run(): void;
}

export function ObjectContextMenu({
  x,
  y,
  label,
  heldBy,
  actions,
  onDismiss,
}: {
  x: number;
  y: number;
  label: string;
  heldBy?: string | null;
  actions: readonly ObjectContextMenuAction[];
  onDismiss(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const estimatedHeight = Math.min(64 + actions.length * 44, 520);
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  const moveFocus = (direction: 1 | -1 | "first" | "last") => {
    if (menuRef.current === null) return;
    const buttons = [...menuRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = direction === "first" ? 0
      : direction === "last" ? buttons.length - 1
        : (current + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div className="object-menu-backdrop" onPointerDown={onDismiss}>
      <div
        ref={menuRef}
        className="object-menu"
        role="menu"
        aria-label="Object actions"
        style={{
          left: `clamp(calc(8px + env(safe-area-inset-left)), ${x}px, calc(100vw - 192px - env(safe-area-inset-right)))`,
          top: `clamp(calc(8px + env(safe-area-inset-top)), ${y}px, calc(100dvh - ${estimatedHeight}px - 8px - env(safe-area-inset-bottom)))`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onDismiss(); }
          else if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
          else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
          else if (event.key === "Home") { event.preventDefault(); moveFocus("first"); }
          else if (event.key === "End") { event.preventDefault(); moveFocus("last"); }
          else if (event.key === "Tab") { event.preventDefault(); moveFocus(event.shiftKey ? -1 : 1); }
        }}
      >
        <header><strong>{label}</strong>{heldBy === null || heldBy === undefined ? null : <small>Held by {heldBy}</small>}</header>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => { action.run(); onDismiss(); }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
