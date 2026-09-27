import type { CanonicalGameState } from "digipology-kernel";
import type { PlayerInfo } from "digipology-protocol";

export type TablePanelId = "players" | "chat" | "rules" | "log" | "settings" | "help" | "game" | null;

export interface TableMenuEntry {
  id: Exclude<TablePanelId, null> | "save" | "objects";
  label: string;
  hostOnly?: boolean;
  shortcut?: string;
}

export function tableMenuEntries(isHost: boolean): TableMenuEntry[] {
  return [
    { id: "players", label: "Players", shortcut: "P" },
    { id: "chat", label: "Chat", shortcut: "C" },
    { id: "rules", label: "Rules", shortcut: "R" },
    { id: "log", label: "Log", shortcut: "L" },
    ...(isHost ? [{ id: "save" as const, label: "Save", hostOnly: true }] : []),
    ...(isHost ? [{ id: "game" as const, label: "Game", hostOnly: true }] : []),
    { id: "objects", label: "Objects" },
    { id: "settings", label: "Settings" },
    { id: "help", label: "Help", shortcut: "?" },
  ];
}

const SEAT_COLORS = ["#ef6461", "#4ea5ff", "#f3c969", "#55d6a7", "#b884ff", "#ff8f4e", "#56d8e4", "#f078b8"];

export interface SeatPickerSeat {
  id: string;
  color: string;
  pattern: number;
  x: number;
  y: number;
  occupant: PlayerInfo | null;
  selected: boolean;
  available: boolean;
}

export function seatPickerSeats(
  state: CanonicalGameState | null,
  players: readonly PlayerInfo[],
  localPlayerId: string,
): SeatPickerSeat[] {
  if (state === null) return [];
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const seats = Object.keys(state.seats).sort();
  return seats.map((id, index) => {
    const angle = Math.PI / 2 + index * (Math.PI * 2 / Math.max(1, seats.length));
    const playerId = state.seats[id]?.playerId;
    const occupant = typeof playerId === "string" ? playerById.get(playerId) ?? null : null;
    return {
      id,
      color: SEAT_COLORS[index % SEAT_COLORS.length]!,
      pattern: index % 4,
      x: 50 - Math.cos(angle) * 40,
      y: 50 + Math.sin(angle) * 37,
      occupant,
      selected: occupant?.playerId === localPlayerId,
      available: occupant === null || occupant.playerId === localPlayerId,
    };
  });
}

export function handCountsByPlayer(state: CanonicalGameState | null): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  if (state === null) return counts;
  for (const seatId of Object.keys(state.seats).sort()) {
    const seat = state.seats[seatId];
    if (typeof seat?.playerId !== "string") continue;
    const handId = typeof seat.handId === "string"
      ? seat.handId
      : Object.keys(state.entities).sort().find((id) => state.entities[id]?.components.hand?.owner === seatId);
    counts.set(seat.playerId, handId === undefined ? 0 : state.entities[handId]?.components.container?.items.length ?? 0);
  }
  return counts;
}

export function currentTurnPlayerId(state: CanonicalGameState | null): string | null {
  if (state === null || typeof state.scriptState !== "object" || state.scriptState === null || Array.isArray(state.scriptState)) return null;
  const stdlib = Reflect.get(state.scriptState, "__stdlib");
  if (typeof stdlib !== "object" || stdlib === null || Array.isArray(stdlib)) return null;
  const turns = Reflect.get(stdlib, "turns");
  if (typeof turns !== "object" || turns === null || Array.isArray(turns) || Reflect.get(turns, "active") !== true) return null;
  const order = Reflect.get(turns, "order");
  const index = Reflect.get(turns, "index");
  if (!Array.isArray(order) || !Number.isSafeInteger(index) || (index as number) < 1) return null;
  const playerId = order[(index as number) - 1];
  return typeof playerId === "string" && state.players[playerId] !== undefined ? playerId : null;
}

export function gameIsOver(state: CanonicalGameState | null): boolean {
  if (state === null || typeof state.scriptState !== "object" || state.scriptState === null || Array.isArray(state.scriptState)) return false;
  return Reflect.get(state.scriptState, "gameOver") === true || Reflect.get(state.scriptState, "game_over") === true;
}
