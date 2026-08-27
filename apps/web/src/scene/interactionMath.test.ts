import { expect, test } from "bun:test";
import { flipQuaternion, rotateQuaternionY } from "./interactionMath";

test("held-object quarter turns compose into a stable half turn", () => {
  const first = rotateQuaternionY({ x: 0, y: 0, z: 0, w: 1 }, Math.PI / 2);
  const second = rotateQuaternionY({ x: first[0], y: first[1], z: first[2], w: first[3] }, Math.PI / 2);
  expect(second[0]).toBeCloseTo(0);
  expect(Math.abs(second[1])).toBeCloseTo(1);
  expect(second[2]).toBeCloseTo(0);
  expect(second[3]).toBeCloseTo(0);
});

test("held-object flip rotates 180 degrees around its local X axis", () => {
  expect(flipQuaternion({ x: 0, y: 0, z: 0, w: 1 })).toEqual([1, 0, 0, 0]);
});
