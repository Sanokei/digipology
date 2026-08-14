import { componentRegistry, type CanonicalGameState, type EntityComponents } from "digipology-kernel";

import type { EditorComponentType, EditorDraft, ScriptBindingComponent } from "../types";

export const EDITOR_COMPONENT_TYPES = [
  ...Object.keys(componentRegistry),
  "script",
] as const satisfies readonly EditorComponentType[];

const EDITOR_REQUIRES: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(Object.entries(componentRegistry).map(([key, definition]) => [key, definition.requires])),
  script: [],
};

function components(draft: EditorDraft, entityId: string): EntityComponents | null {
  const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
  return state.entities[entityId]?.components ?? null;
}

export function defaultComponent(type: string): unknown {
  switch (type) {
    case "transform": return {
      position: { x: 0, y: 0.2, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
    case "grabbable": return { enabled: true, heldBy: null };
    case "flippable": return { flipped: false };
    case "card": return { definitionId: "card", faceUp: true };
    case "container": return { items: [], capacity: null, ordering: "stack", visibility: "public" };
    case "deck": return { enabled: true };
    case "counter": return { value: 0, default: 0, min: null, max: null, step: 1 };
    case "hand": return { owner: "seat-1", canonicalOrder: true };
    case "die": return { definitionId: "standard_d6", value: 1, faces: [1, 2, 3, 4, 5, 6] };
    case "zone": return { shape: "box", acceptedTags: [], visibleInPlay: true };
    case "snap-point": return { radius: 0.5, capacity: 1, tags: [], alignment: {} };
    case "text": return { value: "Text" };
    case "button": return { enabled: true, label: "Button" };
    case "script": return { scriptId: "", bindingId: "", props: {} } satisfies ScriptBindingComponent;
    default: return {};
  }
}

export function requiredComponents(type: string): readonly string[] {
  return EDITOR_REQUIRES[type] ?? [];
}

export function addComponent(draft: EditorDraft, entityId: string, type: string): boolean {
  const target = components(draft, entityId) as Record<string, unknown> | null;
  if (target === null || target[type] !== undefined || !(type in EDITOR_REQUIRES)) return false;
  for (const requirement of requiredComponents(type)) {
    if (target[requirement] === undefined) target[requirement] = defaultComponent(requirement);
  }
  target[type] = defaultComponent(type);
  return true;
}

export function componentDependents(entityComponents: EntityComponents, type: string): string[] {
  return Object.keys(entityComponents)
    .filter((candidate) => requiredComponents(candidate).includes(type))
    .sort();
}

export function removeComponent(draft: EditorDraft, entityId: string, type: string): { ok: true } | { ok: false; reason: string } {
  const target = components(draft, entityId) as Record<string, unknown> | null;
  if (target === null || target[type] === undefined) return { ok: false, reason: `${type} is not attached.` };
  const dependents = componentDependents(target as EntityComponents, type);
  if (dependents.length > 0) {
    return { ok: false, reason: `${type} is required by ${dependents.join(", ")}.` };
  }
  delete target[type];
  return { ok: true };
}

export function updateComponent(
  draft: EditorDraft,
  entityId: string,
  type: string,
  mutate: (component: Record<string, unknown>) => void,
): boolean {
  const target = components(draft, entityId) as Record<string, unknown> | null;
  const component = target?.[type];
  if (typeof component !== "object" || component === null || Array.isArray(component)) return false;
  mutate(component as Record<string, unknown>);
  return true;
}
