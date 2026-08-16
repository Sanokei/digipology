import { expect, test } from "bun:test";

import {
  clampDevicePixelRatio,
  hardwareScalingLevel,
  rendererOverrideFromSearch,
  selectRendererAdapter,
} from "./rendererPolicy";

test("device pixel ratio is normalized and clamped to two", () => {
  expect(clampDevicePixelRatio(0.75)).toBe(1);
  expect(clampDevicePixelRatio(1.5)).toBe(1.5);
  expect(clampDevicePixelRatio(3)).toBe(2);
  expect(clampDevicePixelRatio(Number.NaN)).toBe(1);
  expect(hardwareScalingLevel(2)).toBe(0.5);
  expect(hardwareScalingLevel(4)).toBe(0.5);
});

test("renderer override parsing accepts only supported adapter names", () => {
  expect(rendererOverrideFromSearch("?renderer=lite")).toBe("lite");
  expect(rendererOverrideFromSearch("?renderer=webgl")).toBe("webgl");
  expect(rendererOverrideFromSearch("?renderer=unknown")).toBeNull();
  expect(rendererOverrideFromSearch("")).toBeNull();
});

test("renderer adapter selection covers WebGPU availability and overrides", () => {
  expect(selectRendererAdapter(true, null)).toEqual({ renderer: "lite", requestedLiteFallback: false });
  expect(selectRendererAdapter(false, null)).toEqual({ renderer: "webgl", requestedLiteFallback: false });
  expect(selectRendererAdapter(true, "webgl")).toEqual({ renderer: "webgl", requestedLiteFallback: false });
  expect(selectRendererAdapter(false, "webgl")).toEqual({ renderer: "webgl", requestedLiteFallback: false });
  expect(selectRendererAdapter(true, "lite")).toEqual({ renderer: "lite", requestedLiteFallback: false });
  expect(selectRendererAdapter(false, "lite")).toEqual({ renderer: "webgl", requestedLiteFallback: true });
});
