import type { CanonicalGameState, TransformComponent } from "digipology-kernel";

export interface HandStripItem {
  entityId: string;
  label: string;
  color: string;
  transform?: TransformComponent;
}

export type HandSortMode = "none" | "label";

export function localSeatId(
  state: CanonicalGameState | null,
  playerId: string,
): string | null {
  if (state === null) return null;
  return Object.keys(state.seats).sort().find((id) => state.seats[id]?.playerId === playerId) ?? null;
}

export function localHandId(
  state: CanonicalGameState | null,
  playerId: string,
): string | null {
  if (state === null) return null;
  const seatId = localSeatId(state, playerId);
  if (seatId === null) return null;
  const explicitHandId = state.seats[seatId]?.handId;
  if (typeof explicitHandId === "string") return explicitHandId;
  return Object.keys(state.entities).sort().find((id) => state.entities[id]?.components.hand?.owner === seatId) ?? null;
}

export function compareHandItemsByLabel(left: HandStripItem, right: HandStripItem): number {
  const byLabel = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  return byLabel === 0 ? left.entityId.localeCompare(right.entityId) : byLabel;
}

export function sortHandItems(
  items: readonly HandStripItem[],
  mode: HandSortMode,
): HandStripItem[] {
  return mode === "label" ? [...items].sort(compareHandItemsByLabel) : [...items];
}

export function handPlayActions(
  item: HandStripItem,
  point: { x: number; y: number; z: number },
): [{ type: "entity.grab"; payload: { entityId: string } }, { type: "entity.drop"; payload: { entityId: string; transform: TransformComponent } }] {
  const transform = item.transform ?? {
    position: { x: 0, y: 0.045, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
  return [
    { type: "entity.grab", payload: { entityId: item.entityId } },
    {
      type: "entity.drop",
      payload: {
        entityId: item.entityId,
        transform: { ...transform, position: { x: point.x, y: point.y + 0.045, z: point.z } },
      },
    },
  ];
}

export function localHandItems(
  state: CanonicalGameState | null,
  playerId: string,
  definitions: Readonly<Record<string, { label?: string; color?: string }>>,
): HandStripItem[] {
  if (state === null) return [];
  const handId = localHandId(state, playerId);
  if (handId === null) return [];
  const items = state.entities[handId]?.components.container?.items ?? [];
  return items.flatMap((entityId) => {
    const entity = state.entities[entityId];
    if (entity === undefined) return [];
    const definitionId = entity.components.card?.definitionId;
    const label = definitionId === undefined ? "Card" : definitions[definitionId]?.label ?? "Card";
    return [{
      entityId,
      label,
      color: definitionId === undefined ? "#e7dfc8" : definitions[definitionId]?.color ?? "#e7dfc8",
      ...(entity.components.transform === undefined ? {} : { transform: entity.components.transform }),
    }];
  });
}
