import type { CanonicalGameState } from "digipology-kernel";

import type { HandStripItem } from "../components/HandStrip";

export function localHandItems(
  state: CanonicalGameState | null,
  playerId: string,
  definitions: Readonly<Record<string, { label?: string }>>,
): HandStripItem[] {
  if (state === null) return [];
  const seatId = Object.keys(state.seats).sort().find((id) => state.seats[id]?.playerId === playerId);
  if (seatId === undefined) return [];
  const seat = state.seats[seatId];
  const explicitHandId = typeof seat?.handId === "string" ? seat.handId : null;
  const handId = explicitHandId ?? Object.keys(state.entities).sort().find((id) => state.entities[id]?.components.hand?.owner === seatId);
  if (handId === undefined || handId === null) return [];
  const items = state.entities[handId]?.components.container?.items ?? [];
  return items.flatMap((entityId) => {
    const entity = state.entities[entityId];
    if (entity === undefined) return [];
    const definitionId = entity.components.card?.definitionId;
    const label = definitionId === undefined
      ? entityId
      : definitions[definitionId]?.label ?? definitionId;
    return [{ entityId, label }];
  });
}
