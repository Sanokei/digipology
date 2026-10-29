import { expect, test } from "bun:test";
import { CARD_STOCK, cardStockProfile } from "./cardStock";
import { roundedCardGeometry } from "./pieceGeometry";

test("printed corner masks coincide with the actual stock top contour for a card and a deck", () => {
  for (const [width, height, depth] of [[0.98, CARD_STOCK.singleCardHeight, 1.4], [1.06, 0.312, 1.52], [1.06, 0.012, 1.52], [1.06, 0.004, 1.52]]) {
    const profile = cardStockProfile(width!, height!, depth!);
    const geometry = roundedCardGeometry(width!, height!, depth!);
    const corners: Array<readonly [number, number]> = [];
    for (let vertex = 0; vertex < geometry.positions.length; vertex += 3) {
      const x = Math.abs(geometry.positions[vertex]!); const y = geometry.positions[vertex + 1]!; const z = Math.abs(geometry.positions[vertex + 2]!);
      if (Math.abs(y - height! / 2) < 1e-7 && x >= width! / 2 - profile.radius - 1e-6 && z >= depth! / 2 - profile.radius - 1e-6) corners.push([x, z]);
    }
    expect(corners.length).toBeGreaterThan(20);
    const radiusX = profile.paperShape.radiusX * profile.faceWidth;
    const radiusZ = profile.paperShape.radiusY * profile.faceDepth;
    for (const [x, z] of corners) {
      const maskX = (x - (profile.faceWidth / 2 - radiusX)) / radiusX;
      const maskZ = (z - (profile.faceDepth / 2 - radiusZ)) / radiusZ;
      expect(Math.hypot(maskX, maskZ)).toBeCloseTo(1, 4);
    }
  }
});

test("deck walls stay vertical instead of shading as one inflated bevel across the pile", () => {
  const width = 1.06; const height = 0.312; const depth = 1.52;
  const profile = cardStockProfile(width, height, depth);
  const geometry = roundedCardGeometry(width, height, depth);
  let wallVertices = 0;
  for (let vertex = 0; vertex < geometry.positions.length; vertex += 3) {
    const y = geometry.positions[vertex + 1]!;
    if (Math.abs(y) <= height / 2 - profile.bevel + 1e-7) {
      wallVertices++;
      expect(geometry.normals[vertex + 1]).toBeCloseTo(0, 7);
      expect(Math.hypot(geometry.normals[vertex]!, geometry.normals[vertex + 2]!)).toBeCloseTo(1, 6);
    }
  }
  expect(wallVertices).toBeGreaterThan(20);
});

test("paper strips stop before the stock corners and outside the short bevel", () => {
  const width = 1.06; const height = 0.312; const depth = 1.52;
  const profile = cardStockProfile(width, height, depth);
  expect(profile.edgeWidth / 2).toBeLessThan(width / 2 - profile.radius);
  expect(profile.edgeDepth / 2).toBeLessThan(depth / 2 - profile.radius);
  expect(profile.edgeHeight / 2).toBeCloseTo(height / 2 - profile.bevel, 8);
});
