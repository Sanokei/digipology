import { useMemo, useState } from "react";
import { OBJECT_LIBRARY } from "digipology-kernel";

export function ObjectsMenu({ disabled = false, onSpawn }: {
  disabled?: boolean;
  onSpawn(libraryId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const categories = useMemo(() => {
    const result = new Map<string, typeof OBJECT_LIBRARY>();
    for (const item of OBJECT_LIBRARY) result.set(item.category, [...(result.get(item.category) ?? []), item]);
    return [...result.entries()];
  }, []);
  return <div className="objects-menu">
    <button type="button" className="objects-menu__trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>＋ Objects</button>
    {!open ? null : <div className="objects-menu__panel table-sheet" role="dialog" aria-label="Object library">
      <header><strong>Objects</strong><small>Library v1</small><button type="button" aria-label="Close objects" onClick={() => setOpen(false)}>×</button></header>
      {categories.map(([category, items]) => <section key={category}><h3>{category}</h3><div className="objects-menu__grid">
        {items.map((item) => <button type="button" key={item.id} title={`Spawn ${item.label}`} onClick={() => { onSpawn(item.id); setOpen(false); }}>
          <span className="objects-menu__preview" style={{ background: item.color }} aria-hidden="true">{item.kind === "die" ? item.sides : item.kind === "deck" ? "▤" : item.kind === "bag" ? "⌑" : ""}</span>
          <span>{item.label}</span>
        </button>)}
      </div></section>)}
    </div>}
  </div>;
}
