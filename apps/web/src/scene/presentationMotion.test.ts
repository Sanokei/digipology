import { expect, test } from "bun:test";
import { easeOutCubic, settleBounce, slerpQuaternion, tumbleQuaternion } from "./presentationMotion";

test("easing clamps and reaches exact end states", () => {
  expect(easeOutCubic(-1)).toBe(0);
  expect(easeOutCubic(1)).toBe(1);
  expect(settleBounce(0)).toBe(0);
  expect(settleBounce(1)).toBeCloseTo(0, 12);
});

test("quaternion interpolation remains normalized and exact at the target", () => {
  const halfway = slerpQuaternion([0, 0, 0, 1], [0, 1, 0, 0], 0.5);
  expect(Math.hypot(...halfway)).toBeCloseTo(1, 12);
  expect(slerpQuaternion([0, 0, 0, 1], [0, 1, 0, 0], 1)).toEqual([0, 1, 0, 0]);
});

test("cosmetic tumble always lands on the known canonical orientation", () => {
  const target = [0.1, 0.2, 0.3, 0.9] as const;
  expect(tumbleQuaternion(target, 1)).toEqual([...target]);
  expect(tumbleQuaternion(target, 0.5)).not.toEqual([...target]);
  expect(Math.hypot(...tumbleQuaternion(target, 0.5))).toBeCloseTo(1, 12);
});
