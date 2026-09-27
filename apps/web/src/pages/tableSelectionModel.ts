import type { CanonicalGameState } from "digipology-kernel";

export interface ScreenPoint { x: number; y: number }
export interface SelectionRectangle { start: ScreenPoint; end: ScreenPoint }

export function boxSelectionIds(
  state: CanonicalGameState,
  rectangle: SelectionRectangle,
  project: (point: { x: number; y: number; z: number }) => ScreenPoint | null,
): string[] {
  const contained = new Set<string>();
  for (const entity of Object.values(state.entities)) {
    for (const item of entity.components.container?.items ?? []) contained.add(item);
  }
  const minX = Math.min(rectangle.start.x, rectangle.end.x);
  const maxX = Math.max(rectangle.start.x, rectangle.end.x);
  const minY = Math.min(rectangle.start.y, rectangle.end.y);
  const maxY = Math.max(rectangle.start.y, rectangle.end.y);
  return Object.keys(state.entities).sort().filter((id) => {
    const entity = state.entities[id];
    if (entity?.components.grabbable?.enabled !== true || contained.has(id)) return false;
    const position = entity.components.transform?.position;
    if (position === undefined) return false;
    const point = project(position);
    return point !== null && point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  });
}

export function toggleSelection(current: readonly string[], entityId: string): string[] {
  return current.includes(entityId) ? current.filter((id) => id !== entityId) : [...current, entityId].sort();
}

export function reconcileSelection(current: readonly string[], state: CanonicalGameState | null): string[] {
  return current.filter((id) => state?.entities[id] !== undefined).sort();
}

export function nearestCompatibleSnap(
  state: CanonicalGameState,
  entityId: string,
  position: { x: number; y: number; z: number },
): string | null {
  const tags = state.entities[entityId]?.components.tags?.values ?? [];
  let selected: { id: string; distance: number } | null = null;
  for (const id of Object.keys(state.entities).sort()) {
    const entity = state.entities[id];
    const snap = entity?.components["snap-point"];
    const target = entity?.components.transform?.position;
    if (snap === undefined || target === undefined || (snap.attached?.length ?? 0) >= snap.capacity) continue;
    if (snap.tags.length > 0 && !snap.tags.some((tag) => tags.includes(tag))) continue;
    const distance = (position.x - target.x) ** 2 + (position.y - target.y) ** 2 + (position.z - target.z) ** 2;
    if (distance > snap.radius ** 2) continue;
    if (selected === null || distance < selected.distance || (distance === selected.distance && id < selected.id)) selected = { id, distance };
  }
  return selected?.id ?? null;
}
