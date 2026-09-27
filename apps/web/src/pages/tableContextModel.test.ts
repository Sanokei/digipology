import { expect, test } from "bun:test";
import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import {
  contextActionsFor,
  diceControlLabels,
  hoverStatusText,
  hoverTooltipText,
  keyboardCommandFor,
  keyboardRollActionFor,
  presentationHighlightIds,
  primaryActionFor,
} from "./tableContextModel";

function entity(components: EntityRecord["components"]): EntityRecord {
  return { id: "piece", components };
}

function stateFor(piece: EntityRecord, sandbox = false) {
  return {
    sequence: 0, releaseId: "release", kernelVersion: 1,
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 }, settings: { sandbox },
    players: { me: { id: "me" } },
    seats: { seat_1: { id: "seat_1", playerId: "me", handId: "hand" } },
    entities: {
      [piece.id]: piece,
      hand: { id: "hand", components: { hand: { owner: "seat_1", canonicalOrder: true }, container: { items: [], capacity: null, ordering: "canonical", visibility: "owner:seat_1" } } },
    },
    stacks: {}, scriptState: null, timers: {}, prompts: {},
  } as unknown as CanonicalGameState;
}

test("builds nested deck, sandbox, and component actions with exact child payloads", () => {
  const piece = entity({
    flippable: { flipped: false }, die: { definitionId: "d6", value: 2 }, button: { enabled: true, label: "Go" },
    deck: { enabled: true }, container: { items: ["card"], capacity: null, ordering: "top", visibility: "public" },
    counter: { value: 2, default: 0, min: 0, max: 3 }, lockable: { locked: false },
  });
  const state = stateFor(piece, true);
  state.stacks = { stack: { id: "stack", items: [piece.id] } };
  const actions = contextActionsFor(piece, state, "me", "seat_1", true);
  expect(actions.map((action) => action.id)).toEqual([
    "flip", "roll", "press", "draw", "deal", "search", "shuffle", "cut", "take-top",
    "increment", "decrement", "take-stack-top", "lock", "clone", "delete", "inspect",
  ]);
  expect(actions.find((action) => action.id === "draw")?.children?.at(4)?.action).toEqual({
    type: "deck.draw", payload: { deckId: "piece", count: 5 },
  });
  expect(actions.find((action) => action.id === "deal")?.children).toEqual([
    { id: "deal-all", label: "To all seats", disabled: false, action: { type: "deck.deal", payload: { deckId: "piece", count: 1 } } },
    { id: "deal-seat_1", label: "To seat_1", disabled: false, action: { type: "deck.deal", payload: { deckId: "piece", count: 1, seatId: "seat_1" } } },
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
  expect(actions.map((action) => action.id)).toEqual(["roll", "deal", "search", "shuffle", "cut", "take-top", "increment", "decrement", "inspect"]);
  expect(actions.find((action) => action.id === "roll")?.disabled).toBeTrue();
  expect(actions.find((action) => action.id === "shuffle")?.disabled).toBeTrue();
  expect(actions.find((action) => action.id === "decrement")?.disabled).toBeTrue();
  expect(primaryActionFor(piece, state, "me", "seat_1", true)).toBeNull();
});

test("primary actions follow die, deck, button, flip, then inspect precedence", () => {
  const samples: Array<[EntityRecord, string | null]> = [
    [entity({ die: { definitionId: "d6", value: 1 } }), "roll"],
    [entity({ deck: { enabled: true }, container: { items: ["card"], capacity: null, ordering: "top", visibility: "public" } }), "draw-1"],
    [entity({ button: { enabled: true, label: "Go" } }), "press"],
    [entity({ card: { definitionId: "card", faceUp: true }, flippable: { flipped: false } }), "flip"],
    [entity({ counter: { value: 0, default: 0, min: null, max: null } }), "inspect"],
  ];
  for (const [piece, expected] of samples) expect(primaryActionFor(piece, stateFor(piece), "me", "seat_1", true)?.id ?? null).toBe(expected);
});

test("rotation actions use canonical 15 degree steps and respect hold and lock gates", () => {
  const piece = entity({
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    grabbable: { enabled: true, heldBy: null }, lockable: { locked: false },
  });
  let actions = contextActionsFor(piece, stateFor(piece), "me", "seat_1", true);
  expect(actions.slice(0, 2).map(({ id, label, action, disabled }) => ({ id, label, action, disabled }))).toEqual([
    { id: "rotate-left", label: "Rotate left 15°", disabled: false, action: { type: "entity.rotate", payload: { entityId: "piece", steps: -1 } } },
    { id: "rotate-right", label: "Rotate right 15°", disabled: false, action: { type: "entity.rotate", payload: { entityId: "piece", steps: 1 } } },
  ]);
  piece.components.grabbable!.heldBy = "other";
  actions = contextActionsFor(piece, stateFor(piece), "me", "seat_1", true);
  expect(actions.slice(0, 2).every((action) => action.disabled)).toBe(true);
  piece.components.grabbable!.heldBy = null;
  piece.components.lockable!.locked = true;
  actions = contextActionsFor(piece, stateFor(piece), "me", "seat_1", true);
  expect(actions.slice(0, 2).every((action) => action.disabled)).toBe(true);
});

test("keyboard mapping covers deck draw, die roll, sandbox delete, copy, paste, and escape", () => {
  const die = entity({ die: { definitionId: "d6", value: 1 } });
  const deck = entity({ deck: { enabled: true } });
  expect(keyboardCommandFor({ key: "4", entity: deck })).toEqual({ kind: "action", action: { type: "deck.draw", payload: { deckId: "piece", count: 4 } } });
  expect(keyboardCommandFor({ key: "r", entity: die })).toEqual({ kind: "action", action: { type: "die.roll", payload: { entityId: "piece" } } });
  expect(keyboardCommandFor({ key: "Delete", entity: die, state: stateFor(die, true), selectedIds: ["a", "b"] })).toEqual({ kind: "action", action: { type: "group.delete", payload: { entityIds: ["a", "b"] } } });
  expect(keyboardCommandFor({ key: "c", ctrlOrMeta: true })).toEqual({ kind: "copy" });
  expect(keyboardCommandFor({ key: "v", ctrlOrMeta: true })).toEqual({ kind: "paste" });
  expect(keyboardCommandFor({ key: "Escape" })).toEqual({ kind: "clear-selection" });
  expect(keyboardRollActionFor(die)).toEqual({ type: "die.roll", payload: { entityId: "piece" } });
});

test("labels, tooltips, and duplicate dice labels use public presentation data", () => {
  const dice = [
    { id: "die_9f", components: { die: { definitionId: "red", value: 1 } } },
    { id: "die_ab", components: { die: { definitionId: "red", value: 2 } } },
    { id: "die_raw", components: { die: { definitionId: "unknown", value: 3 } } },
  ] as EntityRecord[];
  expect([...diceControlLabels(dice, { red: { label: "Red die" } }).values()]).toEqual(["Red die 1", "Red die 2", "Die"]);
  expect(hoverTooltipText(dice[0]!, { red: { label: "Red die" } }, "me", [])).toBe("Red die · Value 1");
});

test("presentation indicators include every remotely held and locked entity", () => {
  const state = stateFor(entity({ grabbable: { enabled: true, heldBy: "other" }, lockable: { locked: true } }));
  state.entities.second = { id: "second", components: { grabbable: { enabled: true, heldBy: "other-2" } } };
  state.entities.mine = { id: "mine", components: { grabbable: { enabled: true, heldBy: "me" }, lockable: { locked: true } } };
  expect(presentationHighlightIds(state, "me")).toEqual({ held: ["piece", "second"], locked: ["mine", "piece"] });
  expect(hoverStatusText(state.entities.piece!, "me", [{ playerId: "other", displayName: "Bob" }])).toBe("Bob is holding this");
  expect(hoverStatusText(state.entities.mine!, "me", [])).toBe("Locked");
});
