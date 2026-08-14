import { expect, test } from "bun:test";

import { clampDevicePixelRatio, hardwareScalingLevel } from "./rendererPolicy";

test("device pixel ratio is normalized and clamped to two", () => {
  expect(clampDevicePixelRatio(0.75)).toBe(1);
  expect(clampDevicePixelRatio(1.5)).toBe(1.5);
  expect(clampDevicePixelRatio(3)).toBe(2);
  expect(clampDevicePixelRatio(Number.NaN)).toBe(1);
  expect(hardwareScalingLevel(2)).toBe(0.5);
  expect(hardwareScalingLevel(4)).toBe(0.5);
});
