import { expect, test } from "bun:test";
import { roundedBoxGeometry, roundedCardGeometry, type PieceGeometry } from "./pieceGeometry";

function checkGeometry(geometry: PieceGeometry, width: number, height: number, depth: number): void {
  expect(geometry.positions.length).toBe(geometry.normals.length);
  expect(geometry.uvs.length * 3).toBe(geometry.positions.length * 2);
  expect(geometry.indices.length % 3).toBe(0);
  const half = [width / 2, height / 2, depth / 2];
  for (let offset = 0; offset < geometry.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(geometry.positions[offset + axis]!)).toBeLessThanOrEqual(half[axis]! + 1e-6);
    const normal = geometry.normals.subarray(offset, offset + 3);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 3);
  }
  // Outward winding is essential: Lite and WebGL must not disappear when culled.
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const [a, b, c] = [...geometry.indices.subarray(offset, offset + 3)].map((index) => index * 3);
    const u = [0, 1, 2].map((axis) => geometry.positions[b! + axis]! - geometry.positions[a! + axis]!);
    const v = [0, 1, 2].map((axis) => geometry.positions[c! + axis]! - geometry.positions[a! + axis]!);
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    expect(cross.every(Number.isFinite)).toBe(true);
    const area = Math.hypot(...cross);
    expect(area).toBeGreaterThan(1e-12);
    const outward = cross.reduce((total, component, axis) => total + component * geometry.normals[a! + axis]!, 0);
    expect(outward).toBeGreaterThan(0);
  }
}

test("rounded dice retain dimensions, smooth outward normals and a closed visible silhouette", () => {
  const geometry = roundedBoxGeometry(0.8, 0.8, 0.8, 0.105);
  checkGeometry(geometry, 0.8, 0.8, 0.8);
  expect([...geometry.normals].some((normal) => normal > 0.3 && normal < 0.8)).toBe(true);
});

test("thin cards and full decks retain rounded paper corners without inverted faces", () => {
  checkGeometry(roundedCardGeometry(0.98, 0.09, 1.4), 0.98, 0.09, 1.4);
  checkGeometry(roundedCardGeometry(1.06, 0.402, 1.52), 1.06, 0.402, 1.52);
});
