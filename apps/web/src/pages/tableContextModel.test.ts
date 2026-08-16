import { expect, test } from "bun:test";
import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import { contextActionsFor, diceControlLabels, hoverStatusText, presentationHighlightIds, primaryActionFor } from "./tableContextModel";

function entity(components: EntityRecord["components"]): EntityRecord {
  return { id: "piece", components };
}

function stateFor(piece: EntityRecord, sandbox = false) {
  return {
    sequence: 0,
    releaseId: "release",
    kernelVersion: 1,
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    settings: { sandbox },
    players: { me: { id: "me" } },
    seats: { seat_1: { id: "seat_1", playerId: "me", handId: "hand" } },
    entities: {
      [piece.id]: piece,
      hand: { id: "hand", components: { hand: { owner: "seat_1", canonicalOrder: true }, container: { items: [], capacity: null, ordering: "canonical", visibility: "owner:seat_1" } } },
    },
    stacks: {},
    scriptState: null,
    timers: {},
    prompts: {},
  } as unknown as CanonicalGameState;
}

test("builds the complete component capability matrix with exact payloads", () => {
  const piece = entity({
    flippable: { flipped: false }, die: { definitionId: "d6", value: 2 }, button: { enabled: true, label: "Go" },
    deck: { enabled: true }, container: { items: ["card"], capacity: null, ordering: "top", visibility: "public" },
    counter: { value: 2, default: 0, min: 0, max: 3 }, lockable: { locked: false },
  });
  const state = stateFor(piece, true);
  state.stacks = { stack: { id: "stack", items: [piece.id] } };
  expect(contextActionsFor(piece, state, "me", "seat_1", true)).toEqual([
    { id: "flip", label: "Flip", disabled: false, action: { type: "entity.flip", payload: { entityId: "piece" } } },
    { id: "roll", label: "Roll", disabled: false, action: { type: "die.roll", payload: { entityId: "piece" } } },
    { id: "press", label: "Press", disabled: false, action: { type: "button.press", payload: { entityId: "piece" } } },
    { id: "draw", label: "Draw to hand", disabled: false, action: { type: "deck.draw_to_container", payload: { deckId: "piece", target: "hand", count: 1 } } },
    { id: "shuffle", label: "Shuffle", disabled: false, action: { type: "deck.shuffle", payload: { deckId: "piece" } } },
    { id: "increment", label: "+1", disabled: false, action: { type: "counter.add", payload: { entityId: "piece", amount: 1 } } },
    { id: "decrement", label: "−1", disabled: false, action: { type: "counter.add", payload: { entityId: "piece", amount: -1 } } },
    { id: "take-top", label: "Take top", disabled: false, action: { type: "stack.remove_top", payload: { stackId: "stack" } } },
    { id: "lock", label: "Lock", disabled: false, action: { type: "entity.set_locked", payload: { entityId: "piece", locked: true } } },
    { id: "inspect", label: "Inspect", disabled: false, action: null },
  ]);
});

test("applies bounds, sandbox, hand, enabled, and held gates", () => {
  const piece = entity({
    die: { definitionId: "d6", value: 1 }, grabbable: { enabled: true, heldBy: "other" },
    deck: { enabled: false }, container: { items: [], capacity: null, ordering: "top", visibility: "public" },
    counter: { value: 0, default: 0, min: 0, max: 1 }, lockable: { locked: true },
  });
  const state = stateFor(piece, false);
  delete state.seats.seat_1?.handId;
  delete state.entities.hand;
  const actions = contextActionsFor(piece, state, "me", "seat_1", true);
  expect(actions.map((action) => action.id)).toEqual(["roll", "shuffle", "increment", "decrement", "inspect"]);
  expect(actions.find((action) => action.id === "roll")?.disabled).toBeTrue();
  expect(actions.find((action) => action.id === "shuffle")?.disabled).toBeTrue();
  expect(actions.find((action) => action.id === "decrement")?.disabled).toBeTrue();
  expect(primaryActionFor(piece, state, "me", "seat_1", true)).toBeNull();
});

test("primary actions follow die, deck, button, flip, then inspect precedence", () => {
  const samples: Array<[EntityRecord, NonNullable<ReturnType<typeof primaryActionFor>>["id"] | null]> = [
    [entity({ die: { definitionId: "d6", value: 1 } }), "roll"],
    [entity({ deck: { enabled: true }, container: { items: [], capacity: null, ordering: "top", visibility: "public" } }), "draw"],
    [entity({ button: { enabled: true, label: "Go" } }), "press"],
    [entity({ card: { definitionId: "card", faceUp: true }, flippable: { flipped: false } }), "flip"],
    [entity({ counter: { value: 0, default: 0, min: null, max: null } }), "inspect"],
  ];
  for (const [piece, expected] of samples) {
    expect(primaryActionFor(piece, stateFor(piece), "me", "seat_1", true)?.id ?? null).toBe(expected);
  }
});

test("dice labels use definitions and disambiguate duplicates without raw ids", () => {
  const dice = [
    { id: "die_9f", components: { die: { definitionId: "red", value: 1 } } },
    { id: "die_ab", components: { die: { definitionId: "red", value: 2 } } },
    { id: "die_raw", components: { die: { definitionId: "unknown", value: 3 } } },
  ] as EntityRecord[];
  expect([...diceControlLabels(dice, { red: { label: "Red die" } }).values()]).toEqual(["Red die 1", "Red die 2", "Die"]);
});

test("presentation indicators include every remotely held and locked entity", () => {
  const state = stateFor(entity({ grabbable: { enabled: true, heldBy: "other" }, lockable: { locked: true } }));
  state.entities.second = { id: "second", components: { grabbable: { enabled: true, heldBy: "other-2" } } };
  state.entities.mine = { id: "mine", components: { grabbable: { enabled: true, heldBy: "me" }, lockable: { locked: true } } };
  expect(presentationHighlightIds(state, "me")).toEqual({ held: ["piece", "second"], locked: ["mine", "piece"] });
  expect(hoverStatusText(state.entities.piece!, "me", [{ playerId: "other", displayName: "Bob" }])).toBe("Bob is holding this");
  expect(hoverStatusText(state.entities.mine!, "me", [])).toBe("Locked");
});
