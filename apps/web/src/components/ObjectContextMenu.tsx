export interface ObjectContextMenuAction {
  id: "flip" | "roll";
  label: string;
  run(): void;
}

export function ObjectContextMenu({
  x,
  y,
  actions,
  onDismiss,
}: {
  x: number;
  y: number;
  actions: readonly ObjectContextMenuAction[];
  onDismiss(): void;
}) {
  return (
    <div className="object-menu-backdrop" onPointerDown={onDismiss}>
      <div
        className="object-menu"
        role="menu"
        aria-label="Object actions"
        style={{
          left: `clamp(calc(8px + env(safe-area-inset-left)), ${x}px, calc(100vw - 168px - env(safe-area-inset-right)))`,
          top: `clamp(calc(8px + env(safe-area-inset-top)), ${y}px, calc(100dvh - 120px - env(safe-area-inset-bottom)))`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            onClick={() => { action.run(); onDismiss(); }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
