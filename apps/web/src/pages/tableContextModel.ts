import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import { localHandId } from "./tableHandModel";

export type TableAction = { type: string; payload: unknown };

export interface TableContextAction {
  id: "flip" | "roll" | "press" | "draw" | "shuffle" | "increment" | "decrement" | "take-top" | "lock" | "unlock" | "inspect";
  label: string;
  disabled: boolean;
  action: TableAction | null;
}

function heldByOther(entity: EntityRecord, playerId: string): boolean {
  const heldBy = entity.components.grabbable?.heldBy;
  return typeof heldBy === "string" && heldBy !== playerId;
}

function stackForTop(state: CanonicalGameState, entityId: string): string | null {
  for (const stackId of Object.keys(state.stacks ?? {}).sort()) {
    const stack = state.stacks?.[stackId];
    if (stack?.items.at(-1) === entityId) return stackId;
  }
  return null;
}

export function contextActionsFor(
  entity: EntityRecord,
  state: CanonicalGameState,
  playerId: string,
  _seatId: string | null,
  hasClient: boolean,
): TableContextAction[] {
  const result: TableContextAction[] = [];
  const otherHolds = heldByOther(entity, playerId);
  const add = (action: Omit<TableContextAction, "disabled"> & { disabled?: boolean }) => {
    result.push({ ...action, disabled: action.disabled ?? !hasClient });
  };

  if (entity.components.flippable !== undefined || entity.components.card !== undefined) {
    add({ id: "flip", label: "Flip", action: { type: "entity.flip", payload: { entityId: entity.id } } });
  }
  if (entity.components.die !== undefined) {
    add({ id: "roll", label: "Roll", disabled: !hasClient || otherHolds, action: { type: "die.roll", payload: { entityId: entity.id } } });
  }
  if (entity.components.button?.enabled === true) {
    add({ id: "press", label: "Press", action: { type: "button.press", payload: { entityId: entity.id } } });
  }
  if (entity.components.deck !== undefined) {
    const handId = localHandId(state, playerId);
    if (entity.components.deck.enabled && handId !== null) {
      add({ id: "draw", label: "Draw to hand", action: { type: "deck.draw_to_container", payload: { deckId: entity.id, target: handId, count: 1 } } });
    }
    add({
      id: "shuffle",
      label: "Shuffle",
      disabled: !hasClient || !entity.components.deck.enabled,
      action: { type: "deck.shuffle", payload: { deckId: entity.id } },
    });
  }
  const counter = entity.components.counter;
  if (counter !== undefined) {
    add({
      id: "increment", label: "+1", disabled: !hasClient || (counter.max !== null && counter.value >= counter.max),
      action: { type: "counter.add", payload: { entityId: entity.id, amount: 1 } },
    });
    add({
      id: "decrement", label: "−1", disabled: !hasClient || (counter.min !== null && counter.value <= counter.min),
      action: { type: "counter.add", payload: { entityId: entity.id, amount: -1 } },
    });
  }
  const stackId = stackForTop(state, entity.id);
  if (stackId !== null) {
    add({ id: "take-top", label: "Take top", action: { type: "stack.remove_top", payload: { stackId } } });
  }
  if (entity.components.lockable !== undefined && state.settings.sandbox === true) {
    const locked = entity.components.lockable.locked;
    add({
      id: locked ? "unlock" : "lock",
      label: locked ? "Unlock" : "Lock",
      action: { type: "entity.set_locked", payload: { entityId: entity.id, locked: !locked } },
    });
  }
  result.push({ id: "inspect", label: "Inspect", disabled: false, action: null });
  return result;
}

export function primaryActionFor(
  entity: EntityRecord,
  state: CanonicalGameState,
  playerId: string,
  seatId: string | null,
  hasClient: boolean,
): TableContextAction | null {
  if (!hasClient) return { id: "inspect", label: "Inspect", disabled: false, action: null };
  const actions = contextActionsFor(entity, state, playerId, seatId, hasClient);
  const wanted = entity.components.die !== undefined
    ? "roll"
    : entity.components.deck !== undefined
      ? "draw"
      : entity.components.button !== undefined
        ? "press"
        : entity.components.card !== undefined || entity.components.flippable !== undefined
          ? "flip"
          : "inspect";
  const action = actions.find((candidate) => candidate.id === wanted) ?? null;
  return action?.disabled === true ? null : action;
}

export function entityDisplayLabel(
  entity: EntityRecord,
  definitions: Readonly<Record<string, { label?: string }>>,
): string {
  const definitionId = entity.components.card?.definitionId ?? entity.components.die?.definitionId;
  if (definitionId !== undefined) return definitions[definitionId]?.label ?? (entity.components.die !== undefined ? "Die" : "Card");
  if (entity.components.button !== undefined && entity.components.button.label.length > 0) return entity.components.button.label;
  if (entity.components.deck !== undefined) return "Deck";
  if (entity.components.counter !== undefined) return "Counter";
  if (entity.components.text?.value !== undefined && entity.components.text.value.length > 0) return entity.components.text.value;
  return "Table object";
}

export function heldByDisplayName(
  entity: EntityRecord,
  playerId: string,
  players: readonly { playerId: string; displayName: string }[],
): string | null {
  const heldBy = entity.components.grabbable?.heldBy;
  if (typeof heldBy !== "string" || heldBy === playerId) return null;
  return players.find((player) => player.playerId === heldBy)?.displayName ?? "Another player";
}

export function hoverStatusText(
  entity: EntityRecord,
  playerId: string,
  players: readonly { playerId: string; displayName: string }[],
): string | null {
  const holder = heldByDisplayName(entity, playerId, players);
  if (holder !== null) return `${holder} is holding this`;
  return entity.components.lockable?.locked === true ? "Locked" : null;
}

export function presentationHighlightIds(
  state: CanonicalGameState | null,
  playerId: string,
): { held: string[]; locked: string[] } {
  const entities = state?.entities ?? {};
  const ids = Object.keys(entities).sort();
  return {
    held: ids.filter((id) => {
      const heldBy = entities[id]?.components.grabbable?.heldBy;
      return typeof heldBy === "string" && heldBy !== playerId;
    }),
    locked: ids.filter((id) => entities[id]?.components.lockable?.locked === true),
  };
}

export function diceControlLabels(
  entities: readonly EntityRecord[],
  definitions: Readonly<Record<string, { label?: string }>>,
): Map<string, string> {
  const bases = entities.map((entity) => entityDisplayLabel(entity, definitions));
  const totals = new Map<string, number>();
  for (const base of bases) totals.set(base, (totals.get(base) ?? 0) + 1);
  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  entities.forEach((entity, index) => {
    const base = bases[index] ?? "Die";
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    result.set(entity.id, (totals.get(base) ?? 0) > 1 ? `${base} ${occurrence}` : base);
  });
  return result;
}
