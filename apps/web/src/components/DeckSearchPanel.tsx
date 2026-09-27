import type { CanonicalGameState } from "digipology-kernel";

import { entityDisplayLabel } from "../pages/tableContextModel";

export function DeckSearchPanel({ deckId, state, definitions, onTake, onDismiss }: {
  deckId: string;
  state: CanonicalGameState;
  definitions: Readonly<Record<string, { label?: string }>>;
  onTake(cardId: string): void;
  onDismiss(): void;
}) {
  const ids = state.entities[deckId]?.components.container?.items ?? [];
  return <div className="deck-search-backdrop" onPointerDown={onDismiss}>
    <section className="deck-search table-sheet" role="dialog" aria-modal="true" aria-label="Search deck" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><strong>Search deck</strong><small>Only you can see this list · {ids.length} cards</small></div><button type="button" aria-label="Close search" onClick={onDismiss}>×</button></header>
      <div className="deck-search__cards">
        {[...ids].reverse().map((cardId, index) => {
          const card = state.entities[cardId];
          if (card === undefined) return null;
          return <button type="button" key={cardId} onClick={() => { onTake(cardId); onDismiss(); }}>
            <span>{entityDisplayLabel(card, definitions)}</span><small>{index === 0 ? "Top card" : `#${index + 1} from top`}</small>
          </button>;
        })}
      </div>
    </section>
  </div>;
}
