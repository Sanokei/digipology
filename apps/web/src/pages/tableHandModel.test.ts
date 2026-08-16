import { expect, test } from "bun:test";
import type { CanonicalGameState } from "digipology-kernel";

import { handPlayActions, localHandId, localHandItems, sortHandItems } from "./tableHandModel";

test("local hand follows the player's seat hand container in canonical order", () => {
  const state = {
    seats: { red: { id: "red", playerId: "p1", handId: "red-hand" } },
    entities: {
      "red-hand": { id: "red-hand", components: { hand: { owner: "red", canonicalOrder: true }, container: { items: ["c2", "c1"], capacity: 10, ordering: "canonical", visibility: "owner:red" } } },
      c1: { id: "c1", components: { card: { definitionId: "ace", faceUp: false } } },
      c2: { id: "c2", components: { card: { definitionId: "king", faceUp: false } } },
    },
  } as unknown as CanonicalGameState;

  expect(localHandItems(state, "p1", { ace: { label: "Ace" }, king: { label: "King" } })).toEqual([
    { entityId: "c2", label: "King", color: "#e7dfc8" },
    { entityId: "c1", label: "Ace", color: "#e7dfc8" },
  ]);
  expect(localHandId(state, "p1")).toBe("red-hand");
  expect(localHandItems(state, "someone-else", {})).toEqual([]);
});

test("local label sorting is stable and leaves canonical order untouched", () => {
  const canonical = [
    { entityId: "c2", label: "king", color: "#222222" },
    { entityId: "c3", label: "Ace", color: "#333333" },
    { entityId: "c1", label: "ace", color: "#111111" },
  ];
  expect(sortHandItems(canonical, "none").map((item) => item.entityId)).toEqual(["c2", "c3", "c1"]);
  expect(sortHandItems(canonical, "label").map((item) => item.entityId)).toEqual(["c1", "c3", "c2"]);
  expect(canonical.map((item) => item.entityId)).toEqual(["c2", "c3", "c1"]);
});

test("playing a tray card builds a grab/drop burst at the projected table point", () => {
  expect(handPlayActions(
    { entityId: "card", label: "Ace", color: "#ffffff" },
    { x: 2, y: 0, z: -1 },
  )).toEqual([
    { type: "entity.grab", payload: { entityId: "card" } },
    {
      type: "entity.drop",
      payload: {
        entityId: "card",
        transform: {
          position: { x: 2, y: 0.045, z: -1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    },
  ]);
});
