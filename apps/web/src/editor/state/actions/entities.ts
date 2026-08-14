import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import type { EditorDraft } from "../types";

function state(draft: EditorDraft): CanonicalGameState {
  return draft.bundle.initialSnapshot.state as CanonicalGameState;
}

export function renameEntity(draft: EditorDraft, entityId: string, requestedId: string): string | null {
  const entities = state(draft).entities;
  const nextId = requestedId.trim();
  const entity = entities[entityId];
  if (entity === undefined || nextId === "" || (nextId !== entityId && entities[nextId] !== undefined)) return null;
  if (nextId === entityId) return entityId;
  delete entities[entityId];
  entity.id = nextId;
  entities[nextId] = entity;
  for (const candidate of Object.values(entities)) {
    const container = candidate.components.container;
    if (container !== undefined) {
      container.items = container.items.map((id) => id === entityId ? nextId : id);
    }
  }
  return nextId;
}

export function duplicateEntity(draft: EditorDraft, entityId: string): string | null {
  const entities = state(draft).entities;
  const source = entities[entityId];
  if (source === undefined) return null;
  let nextId = `${entityId}_copy`;
  let suffix = 2;
  while (entities[nextId] !== undefined) {
    nextId = `${entityId}_copy_${suffix}`;
    suffix += 1;
  }
  const copy = structuredClone(source) as EntityRecord;
  copy.id = nextId;
  if (copy.components.grabbable !== undefined) copy.components.grabbable.heldBy = null;
  if (copy.components.container !== undefined) copy.components.container.items = [];
  entities[nextId] = copy;
  return nextId;
}

export function deleteEntity(draft: EditorDraft, entityId: string): boolean {
  const entities = state(draft).entities;
  if (entities[entityId] === undefined) return false;
  delete entities[entityId];
  for (const entity of Object.values(entities)) {
    const container = entity.components.container;
    if (container !== undefined) {
      container.items = container.items.filter((id) => id !== entityId);
    }
  }
  return true;
}
