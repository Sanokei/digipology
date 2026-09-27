import type { KernelEvent } from "digipology-kernel";

import type { SceneSound } from "./sceneAudio";

const SOUND_BY_EVENT: Readonly<Record<string, SceneSound>> = {
  "deck.merged": "card-slide",
  "deck.dealt": "card-slide",
  "deck.drawn": "card-slide",
  "deck.taken": "card-slide",
  "entity.spawned": "piece-place",
  "entity.destroyed": "piece-pick",
  "group.destroyed": "piece-pick",
  "deck.shuffled": "deck-shuffle",
  "deck.cut": "card-slide",
};

/** Reduces one action's event batch to tactile cues without double-playing a category. */
export function soundsForSceneEvents(events: readonly KernelEvent[]): readonly SceneSound[] {
  const sounds = new Set<SceneSound>();
  for (const event of events) {
    const sound = SOUND_BY_EVENT[event.type];
    if (sound !== undefined) sounds.add(sound);
  }
  return [...sounds];
}

export interface CardFlight {
  readonly deckId: string;
  readonly seatId: string;
  readonly count: number;
}

/** Extracts public deal/draw destinations without exposing private card identities. */
export function cardFlightsForSceneEvents(
  events: readonly KernelEvent[],
  handSeatIds: Readonly<Record<string, string>>,
): readonly CardFlight[] {
  const flights: CardFlight[] = [];
  for (const event of events) {
    if (event.type === "deck.dealt") {
      const data = event.data as { deckId?: unknown; targets?: unknown };
      if (typeof data.deckId !== "string" || !Array.isArray(data.targets)) continue;
      for (const target of data.targets) {
        if (typeof target !== "object" || target === null) continue;
        const { seatId, items } = target as { seatId?: unknown; items?: unknown };
        if (typeof seatId === "string" && Array.isArray(items) && items.length > 0) {
          flights.push({ deckId: data.deckId, seatId, count: items.length });
        }
      }
    } else if (event.type === "deck.drawn") {
      const data = event.data as { deckId?: unknown; target?: unknown; count?: unknown };
      if (typeof data.deckId !== "string" || typeof data.target !== "string") continue;
      const seatId = handSeatIds[data.target];
      if (seatId !== undefined && typeof data.count === "number" && data.count > 0) {
        flights.push({ deckId: data.deckId, seatId, count: data.count });
      }
    }
  }
  return flights;
}
