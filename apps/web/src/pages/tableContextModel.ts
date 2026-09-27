import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import { localHandId } from "./tableHandModel";

export type TableAction = { type: string; payload: unknown };

export interface TableContextAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  children?: TableContextAction[];
  disabled: boolean;
  action: TableAction | null;
  intent?: "inspect" | "search";
}

function heldByOther(entity: EntityRecord, playerId: string): boolean {
  const heldBy = entity.components.grabbable?.heldBy;
  return typeof heldBy === "string" && heldBy !== playerId;
}

function stackForTop(state: CanonicalGameState, entityId: string): string | null {
  for (const stackId of Object.keys(state.stacks ?? {}).sort()) {
    if (state.stacks?.[stackId]?.items.at(-1) === entityId) return stackId;
  }
  return null;
}

export function contextActionsFor(
  entity: EntityRecord,
  state: CanonicalGameState,
  playerId: string,
  _seatId: string | null,
  hasClient: boolean,
  selectedIds: readonly string[] = [],
): TableContextAction[] {
  const result: TableContextAction[] = [];
  const otherHolds = heldByOther(entity, playerId);
  const add = (action: Omit<TableContextAction, "disabled"> & { disabled?: boolean }) => {
    result.push({ ...action, disabled: action.disabled ?? !hasClient });
  };

  if (entity.components.flippable !== undefined || entity.components.card !== undefined) {
    add({ id: "flip", label: "Flip", icon: "↕", shortcut: "F", action: { type: "entity.flip", payload: { entityId: entity.id } } });
  }
  if (entity.components.transform !== undefined) {
    const disabled = !hasClient || otherHolds || entity.components.lockable?.locked === true;
    add({ id: "rotate-left", label: "Rotate left 15°", icon: "↶", shortcut: "Q", disabled, action: { type: "entity.rotate", payload: { entityId: entity.id, steps: -1 } } });
    add({ id: "rotate-right", label: "Rotate right 15°", icon: "↷", shortcut: "E", disabled, action: { type: "entity.rotate", payload: { entityId: entity.id, steps: 1 } } });
  }
  if (entity.components.die !== undefined) {
    add({ id: "roll", label: "Roll", icon: "⚄", shortcut: "R", disabled: !hasClient || otherHolds, action: { type: "die.roll", payload: { entityId: entity.id } } });
  }
  if (entity.components.button?.enabled === true) add({ id: "press", label: "Press", icon: "●", action: { type: "button.press", payload: { entityId: entity.id } } });
  if (entity.components.deck !== undefined) {
    const deckEnabled = entity.components.deck.enabled;
    const cardCount = entity.components.container?.items.length ?? 0;
    if (entity.components.deck.enabled && localHandId(state, playerId) !== null) {
      add({
        id: "draw", label: "Draw", icon: "⇥", shortcut: "1–9", action: null,
        children: Array.from({ length: 9 }, (_, index) => ({
          id: `draw-${index + 1}`, label: String(index + 1), disabled: !hasClient || otherHolds || cardCount < index + 1,
          action: { type: "deck.draw", payload: { deckId: entity.id, count: index + 1 } },
        })),
      });
    }
    const seated = Object.keys(state.seats).sort().filter((id) => typeof state.seats[id]?.playerId === "string");
    add({
      id: "deal", label: "Deal", icon: "↗", action: null,
      children: [
        { id: "deal-all", label: "To all seats", disabled: !hasClient || otherHolds || !deckEnabled || seated.length === 0 || cardCount < seated.length, action: { type: "deck.deal", payload: { deckId: entity.id, count: 1 } } },
        ...seated.map((seatId) => ({ id: `deal-${seatId}`, label: `To ${seatId}`, disabled: !hasClient || otherHolds || !deckEnabled || cardCount === 0, action: { type: "deck.deal", payload: { deckId: entity.id, count: 1, seatId } } })),
      ],
    });
    add({ id: "search", label: "Search", icon: "⌕", disabled: !hasClient || otherHolds || !deckEnabled || cardCount === 0 || localHandId(state, playerId) === null, action: null, intent: "search" });
    add({ id: "shuffle", label: "Shuffle", icon: "⤨", disabled: !hasClient || otherHolds || !deckEnabled, action: { type: "deck.shuffle", payload: { deckId: entity.id } } });
    add({ id: "cut", label: "Cut", icon: "✂", disabled: !hasClient || otherHolds || !deckEnabled || cardCount < 2, action: { type: "deck.cut", payload: { deckId: entity.id } } });
    add({ id: "take-top", label: "Take top", icon: "⇧", disabled: !hasClient || otherHolds || !deckEnabled || cardCount === 0, action: { type: "deck.take_top", payload: { deckId: entity.id } } });
  }
  if (entity.components.container !== undefined && entity.components.library?.itemId === "tool_bag") {
    add({ id: "take-container-top", label: "Take top", icon: "⇧", disabled: !hasClient || entity.components.container.items.length === 0, action: { type: "container.take", payload: { containerId: entity.id, mode: "top" } } });
    add({ id: "take-container-random", label: "Take random", icon: "?", disabled: !hasClient || entity.components.container.items.length === 0, action: { type: "container.take", payload: { containerId: entity.id, mode: "random" } } });
  }
  const counter = entity.components.counter;
  if (counter !== undefined) {
    add({ id: "increment", label: "+1", disabled: !hasClient || (counter.max !== null && counter.value >= counter.max), action: { type: "counter.add", payload: { entityId: entity.id, amount: 1 } } });
    add({ id: "decrement", label: "−1", disabled: !hasClient || (counter.min !== null && counter.value <= counter.min), action: { type: "counter.add", payload: { entityId: entity.id, amount: -1 } } });
  }
  const stackId = stackForTop(state, entity.id);
  if (stackId !== null) add({ id: "take-stack-top", label: "Take stack top", icon: "⇧", action: { type: "stack.remove_top", payload: { stackId } } });

  const sandbox = state.settings.sandbox === true || state.settings.allowSpawn === true;
  if (entity.components.lockable !== undefined && sandbox) {
    const locked = entity.components.lockable.locked;
    add({ id: locked ? "unlock" : "lock", label: locked ? "Unlock" : "Lock", icon: locked ? "◉" : "◎", action: { type: "entity.set_locked", payload: { entityId: entity.id, locked: !locked } } });
  }
  if (sandbox) {
    add({ id: "clone", label: "Clone", icon: "⧉", shortcut: "Ctrl/Cmd+C, Ctrl/Cmd+V", action: { type: "entity.clone", payload: { entityId: entity.id } } });
    add({ id: "delete", label: "Delete", icon: "⌫", shortcut: "Delete", action: { type: "entity.delete", payload: { entityId: entity.id } } });
  }
  if (selectedIds.length > 1 && selectedIds.includes(entity.id)) {
    add({
      id: "group", label: `Group (${selectedIds.length})`, icon: "▦", action: null,
      children: [
        { id: "group-flip", label: "Flip", disabled: !hasClient, action: { type: "group.flip", payload: { entityIds: [...selectedIds] } } },
        { id: "group-rotate-left", label: "Rotate left", disabled: !hasClient, action: { type: "group.rotate", payload: { entityIds: [...selectedIds], steps: -1 } } },
        { id: "group-rotate-right", label: "Rotate right", disabled: !hasClient, action: { type: "group.rotate", payload: { entityIds: [...selectedIds], steps: 1 } } },
        ...(sandbox ? [{ id: "group-delete", label: "Delete", disabled: !hasClient, action: { type: "group.delete", payload: { entityIds: [...selectedIds] } } }] : []),
      ],
    });
  }
  result.push({ id: "inspect", label: "Inspect", icon: "ⓘ", disabled: false, action: null, intent: "inspect" });
  return result;
}

export function keyboardRollActionFor(entity: EntityRecord): TableAction | null {
  if (entity.components.die !== undefined) return { type: "die.roll", payload: { entityId: entity.id } };
  if (entity.components.deck?.enabled === true) return { type: "deck.shuffle", payload: { deckId: entity.id } };
  return null;
}

export type TableKeyboardCommand = { kind: "action"; action: TableAction } | { kind: "copy" } | { kind: "paste" } | { kind: "clear-selection" };

export function keyboardCommandFor(input: {
  key: string; ctrlOrMeta?: boolean; entity?: EntityRecord; state?: CanonicalGameState | null; selectedIds?: readonly string[];
}): TableKeyboardCommand | null {
  const key = input.key.toLowerCase();
  if (input.ctrlOrMeta && key === "c") return { kind: "copy" };
  if (input.ctrlOrMeta && key === "v") return { kind: "paste" };
  if (input.key === "Escape") return { kind: "clear-selection" };
  const entity = input.entity;
  if (entity === undefined) return null;
  if (/^[1-9]$/.test(input.key) && entity.components.deck?.enabled === true) return { kind: "action", action: { type: "deck.draw", payload: { deckId: entity.id, count: Number(input.key) } } };
  if (key === "r" && entity.components.die !== undefined) return { kind: "action", action: { type: "die.roll", payload: { entityId: entity.id } } };
  if (input.key === "Delete" && (input.state?.settings.sandbox === true || input.state?.settings.allowSpawn === true)) {
    const ids = input.selectedIds?.length ? [...input.selectedIds] : [entity.id];
    return { kind: "action", action: ids.length > 1 ? { type: "group.delete", payload: { entityIds: ids } } : { type: "entity.delete", payload: { entityId: ids[0] } } };
  }
  return null;
}

export function primaryActionFor(entity: EntityRecord, state: CanonicalGameState, playerId: string, seatId: string | null, hasClient: boolean): TableContextAction | null {
  if (!hasClient) return { id: "inspect", label: "Inspect", disabled: false, action: null, intent: "inspect" };
  const actions = contextActionsFor(entity, state, playerId, seatId, hasClient);
  const wanted = entity.components.die !== undefined ? "roll" : entity.components.deck !== undefined ? "draw-1" : entity.components.button !== undefined ? "press" : entity.components.card !== undefined || entity.components.flippable !== undefined ? "flip" : "inspect";
  const action = actions.flatMap((candidate) => [candidate, ...(candidate.children ?? [])]).find((candidate) => candidate.id === wanted) ?? null;
  return action?.disabled === true ? null : action;
}

export function entityDisplayLabel(entity: EntityRecord, definitions: Readonly<Record<string, { label?: string }>>): string {
  const definitionId = entity.components.appearance?.definitionId ?? entity.components.card?.definitionId ?? entity.components.die?.definitionId;
  if (definitionId !== undefined) return definitions[definitionId]?.label ?? entity.components.library?.label ?? (entity.components.die !== undefined ? "Die" : "Card");
  if (entity.components.library !== undefined) return entity.components.library.label;
  if (entity.components.button !== undefined && entity.components.button.label.length > 0) return entity.components.button.label;
  if (entity.components.deck !== undefined) return "Deck";
  if (entity.components.counter !== undefined) return "Counter";
  if (entity.components.text?.value) return entity.components.text.value;
  return "Table object";
}

export function heldByDisplayName(entity: EntityRecord, playerId: string, players: readonly { playerId: string; displayName: string }[]): string | null {
  const heldBy = entity.components.grabbable?.heldBy;
  if (typeof heldBy !== "string" || heldBy === playerId) return null;
  return players.find((player) => player.playerId === heldBy)?.displayName ?? "Another player";
}

export function hoverStatusText(entity: EntityRecord, playerId: string, players: readonly { playerId: string; displayName: string }[]): string | null {
  const holder = heldByDisplayName(entity, playerId, players);
  if (holder !== null) return `${holder} is holding this`;
  return entity.components.lockable?.locked === true ? "Locked" : null;
}

export function hoverTooltipText(entity: EntityRecord, definitions: Readonly<Record<string, { label?: string }>>, playerId: string, players: readonly { playerId: string; displayName: string }[]): string {
  const details = entity.components.deck !== undefined ? `${entity.components.container?.items.length ?? 0} cards` : entity.components.die !== undefined ? `Value ${String(entity.components.die.value)}` : entity.components.counter !== undefined ? `Value ${entity.components.counter.value}` : null;
  return [entityDisplayLabel(entity, definitions), details, hoverStatusText(entity, playerId, players)].filter(Boolean).join(" · ");
}

export function presentationHighlightIds(state: CanonicalGameState | null, playerId: string): { held: string[]; locked: string[] } {
  const entities = state?.entities ?? {};
  const ids = Object.keys(entities).sort();
  return {
    held: ids.filter((id) => { const heldBy = entities[id]?.components.grabbable?.heldBy; return typeof heldBy === "string" && heldBy !== playerId; }),
    locked: ids.filter((id) => entities[id]?.components.lockable?.locked === true),
  };
}

export function diceControlLabels(entities: readonly EntityRecord[], definitions: Readonly<Record<string, { label?: string }>>): Map<string, string> {
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
