import { expect, test } from "bun:test";
import { CreateBoxVertexData } from "@babylonjs/core/Meshes/Builders/boxBuilder";
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
  // Outward normals and Babylon's clockwise, left-handed front-face convention.
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const [a, b, c] = [...geometry.indices.subarray(offset, offset + 3)].map((index) => index * 3);
    const u = [0, 1, 2].map((axis) => geometry.positions[b! + axis]! - geometry.positions[a! + axis]!);
    const v = [0, 1, 2].map((axis) => geometry.positions[c! + axis]! - geometry.positions[a! + axis]!);
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    expect(cross.every(Number.isFinite)).toBe(true);
    const area = Math.hypot(...cross);
    expect(area).toBeGreaterThan(1e-12);
    const outward = cross.reduce((total, component, axis) => total + component * geometry.normals[a! + axis]!, 0);
    expect(outward).toBeLessThan(0);
  }
}

test("rounded geometry follows the installed Babylon builder winding while keeping outward normals", () => {
  const native = CreateBoxVertexData({ size: 0.8 });
  const rounded = roundedBoxGeometry(0.8, 0.8, 0.8);
  for (const geometry of [native, rounded]) {
    const positions = geometry.positions!; const normals = geometry.normals!; const indices = geometry.indices!;
    const [a, b, c] = [indices[0]!, indices[1]!, indices[2]!].map((index) => index * 3);
    const u = [0, 1, 2].map((axis) => positions[b! + axis]! - positions[a! + axis]!);
    const v = [0, 1, 2].map((axis) => positions[c! + axis]! - positions[a! + axis]!);
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    expect(cross.reduce((sum, value, axis) => sum + value * normals[a! + axis]!, 0)).toBeLessThan(0);
    expect([0, 1, 2].reduce((sum, axis) => sum + positions[a! + axis]! * normals[a! + axis]!, 0)).toBeGreaterThan(0);
  }
});

test("rounded dice retain dimensions, smooth outward normals and a closed visible silhouette", () => {
  const geometry = roundedBoxGeometry(0.8, 0.8, 0.8, 0.105);
  checkGeometry(geometry, 0.8, 0.8, 0.8);
  expect([...geometry.normals].some((normal) => normal > 0.3 && normal < 0.8)).toBe(true);
});

test("thin cards and full decks retain rounded paper corners without inverted faces", () => {
  checkGeometry(roundedCardGeometry(0.98, 0.09, 1.4), 0.98, 0.09, 1.4);
  checkGeometry(roundedCardGeometry(1.06, 0.402, 1.52), 1.06, 0.402, 1.52);
});
