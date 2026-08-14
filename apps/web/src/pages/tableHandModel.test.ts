import { expect, test } from "bun:test";
import type { CanonicalGameState } from "digipology-kernel";

import { localHandItems } from "./tableHandModel";

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
    { entityId: "c2", label: "King" },
    { entityId: "c1", label: "Ace" },
  ]);
  expect(localHandItems(state, "someone-else", {})).toEqual([]);
});
