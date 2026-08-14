import { useState } from "react";

export interface HandStripItem {
  entityId: string;
  label: string;
}

export function HandStrip({ items }: { items: readonly HandStripItem[] }) {
  const [inspected, setInspected] = useState<HandStripItem | null>(null);
  return (
    <>
      <section className={`hand-strip${items.length === 0 ? " hand-strip--empty" : ""}`} aria-label="Your hand">
        <div className="hand-strip__heading"><span>Hand</span><em>{items.length}</em></div>
        {items.length === 0
          ? <span className="hand-strip__empty">Your hand is empty</span>
          : <div className="hand-strip__cards">{items.map((item) => (
              <button key={item.entityId} type="button" onClick={() => setInspected(item)} aria-label={`Inspect ${item.label}`}>
                <span>{item.label}</span>
              </button>
            ))}</div>}
      </section>
      {inspected === null ? null : (
        <div className="hand-inspect" role="presentation" onPointerDown={() => setInspected(null)}>
          <article role="dialog" aria-modal="true" aria-label={`Inspecting ${inspected.label}`} onPointerDown={(event) => event.stopPropagation()}>
            <button className="hand-inspect__close" type="button" onClick={() => setInspected(null)} aria-label="Close inspect">×</button>
            <div className="hand-inspect__card"><span>{inspected.label}</span></div>
            <strong>{inspected.label}</strong>
          </article>
        </div>
      )}
    </>
  );
}
