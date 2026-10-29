import { cloneCanonical } from "./canonical";
import type { CanonicalGameState } from "./types";

export interface InitialSessionPlayer {
  playerId: string;
  name: string;
  seatId: string;
}

/** New-session metadata only. Never changes a release or an already-started game. */
export function seedInitialRoster(state: CanonicalGameState, roster: readonly InitialSessionPlayer[]): CanonicalGameState {
  if (state.sequence !== 0) throw new TypeError("An initial roster requires sequence zero");
  const playerIds = new Set<string>();
  const seatIds = new Set<string>();
  for (const player of roster) {
    if (typeof player.playerId !== "string" || typeof player.seatId !== "string" || typeof player.name !== "string" ||
      !player.playerId || !player.seatId || playerIds.has(player.playerId) || seatIds.has(player.seatId)) {
      throw new TypeError("An initial roster requires distinct non-empty players and seats");
    }
    playerIds.add(player.playerId); seatIds.add(player.seatId);
  }
  const next = cloneCanonical(state);
  const previousOwners = new Map<string, string>();
  next.players = {};
  for (const id of Object.keys(next.seats).sort()) next.seats[id]!.playerId = null;
  for (const player of roster) {
    const oldPlayerId = Object.hasOwn(state.seats, player.seatId) ? state.seats[player.seatId]?.playerId : undefined;
    if (typeof oldPlayerId === "string") previousOwners.set(oldPlayerId, player.playerId);
    Object.defineProperty(next.players, player.playerId, { value: { id: player.playerId, name: player.name }, enumerable: true, writable: true, configurable: true });
    const seat = Object.hasOwn(next.seats, player.seatId) ? next.seats[player.seatId] : undefined;
    Object.defineProperty(next.seats, player.seatId, { value: { ...seat, id: player.seatId, playerId: player.playerId }, enumerable: true, writable: true, configurable: true });
  }
  for (const id of Object.keys(next.entities).sort()) {
    const components = next.entities[id]!.components;
    const hand = components.hand;
    if (hand && previousOwners.has(hand.owner)) hand.owner = previousOwners.get(hand.owner)!;
    const container = components.container;
    if (container?.visibility.startsWith("owner:")) {
      const replacement = previousOwners.get(container.visibility.slice(6));
      if (replacement) container.visibility = `owner:${replacement}`;
    }
  }
  return next;
}
