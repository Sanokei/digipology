import { expect, test } from "bun:test";
import { canonicalPieceY, physicalPieceY } from "./cardPhysical";

test("thin stock rests on felt while preserving canonical drops and authored elevated pieces", () => {
  expect(physicalPieceY(.045, .006, true)).toBe(.006);
  expect(canonicalPieceY(.006, .006, true)).toBe(.045);
  expect(physicalPieceY(.045, .012, true)).toBe(.012);
  expect(canonicalPieceY(.012, .012, true)).toBe(.045);
  expect(physicalPieceY(2, .006, true)).toBe(2);
  expect(canonicalPieceY(2, .006, true)).toBe(2);
  // A one-card deck shares the physical height, not the legacy loose-card offset.
  expect(physicalPieceY(.045, .006, false)).toBe(.045);
  expect(canonicalPieceY(.006, .006, false)).toBe(.006);
});
