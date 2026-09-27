import { describe, expect, test } from "bun:test";
import type { JsonValue, KernelEvent } from "digipology-kernel";

import { cardFlightsForSceneEvents, soundsForSceneEvents } from "./scenePresentationEvents";

const event = (type: string, data: Record<string, JsonValue> = {}): KernelEvent => ({ type, sequence: 1, actionId: "action", data });

describe("scene presentation events", () => {
  test("maps interaction events to one tactile cue per sound", () => {
    expect(soundsForSceneEvents([
      event("deck.merged"), event("deck.dealt"), event("deck.drawn"), event("deck.taken"),
      event("entity.spawned"), event("entity.destroyed"), event("group.destroyed"),
      event("deck.shuffled"), event("deck.cut"),
    ])).toEqual(["card-slide", "piece-place", "piece-pick", "deck-shuffle"]);
  });

  test("extracts public deal and draw flights", () => {
    expect(cardFlightsForSceneEvents([
      event("deck.dealt", { deckId: "deck", targets: [{ seatId: "south", items: ["a", "b"] }] }),
      event("deck.drawn", { deckId: "deck", target: "hand-north", count: 1, items: ["private"] }),
    ], { "hand-north": "north" })).toEqual([
      { deckId: "deck", seatId: "south", count: 2 },
      { deckId: "deck", seatId: "north", count: 1 },
    ]);
  });
});
