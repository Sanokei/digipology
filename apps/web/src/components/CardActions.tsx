import { useState } from "react";
import type { EntityRecord } from "digipology-kernel";
import { readCardDesigns } from "../scene/cardDesigns";

export function CardActions({ entities, handId, disabled, designs: content, onAction }: { entities: readonly EntityRecord[]; handId: string | null; disabled: boolean; designs?: string | null | undefined; onAction(action: { type: string; payload: unknown }): void }) {
  const [selected, setSelected] = useState("");
  const decks = entities.filter((entity) => entity.components.deck?.enabled);
  if (!decks.length) return null;
  const deck = decks.find((entity) => entity.id === selected) ?? decks[0]!;
  const designs = readCardDesigns(content);
  return <aside className={`card-controls dice-controls${decks.length > 1 ? " card-controls--multiple" : ""}`} aria-label="Card actions"><span>Cards</span>
    {decks.length > 1 ? <label>Deck<select aria-label="Draw from deck" value={deck.id} onChange={(event) => setSelected(event.currentTarget.value)}>{decks.map((d) => { const familyId = designs?.decks.find((b) => b.entityId === d.id)?.familyId; const label = designs?.families.find((f) => f.id === familyId)?.label ?? d.id; return <option key={d.id} value={d.id}>{label} · {d.components.container?.items.length ?? 0} cards</option>; })}</select></label> : null}
    <div><button type="button" disabled={disabled || !handId || !deck.components.container?.items.length} onClick={() => onAction({ type: "deck.draw_to_container", payload: { deckId: deck.id, target: handId, count: 1 } })}>Draw card</button><button type="button" disabled={disabled} onClick={() => onAction({ type: "deck.shuffle", payload: { deckId: deck.id } })}>Shuffle deck</button>{decks.length === 1 ? <output aria-label="Cards remaining">{deck.components.container?.items.length ?? 0}</output> : null}</div>
  </aside>;
}
