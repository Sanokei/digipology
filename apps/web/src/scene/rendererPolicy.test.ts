import { expect, test } from "bun:test";

import {
  clampDevicePixelRatio,
  hardwareScalingLevel,
  softwareRenderingScale,
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

test("software rendering bounds actual buffer pixels without reducing a small surface or changing the hardware policy", () => {
  const scale = softwareRenderingScale(1440, 960, 2);
  expect(1440 * 960 / scale ** 2).toBeCloseTo(600_000);
  expect(softwareRenderingScale(390, 300, 2)).toBe(0.5);
  expect(softwareRenderingScale(0, 0, 2)).toBe(0.5);
  expect(softwareRenderingScale(Number.NaN, 960, 1)).toBe(1);
  expect(hardwareScalingLevel(2)).toBe(0.5);
});

test("renderer override parsing accepts only supported adapter names", () => {
  expect(rendererOverrideFromSearch("?renderer=lite")).toBe("lite");
  expect(rendererOverrideFromSearch("?renderer=webgl")).toBe("webgl");
  expect(rendererOverrideFromSearch("?renderer=unknown")).toBeNull();
  expect(rendererOverrideFromSearch("")).toBeNull();
});

test("renderer adapter selection covers WebGPU availability and overrides", () => {
  expect(selectRendererAdapter(true, null)).toEqual({ renderer: "lite", requestedLiteFallback: false, reason: "webgpu" });
  expect(selectRendererAdapter(false, null)).toEqual({ renderer: "webgl", requestedLiteFallback: false, reason: "no-webgpu" });
  expect(selectRendererAdapter(true, "webgl")).toEqual({ renderer: "webgl", requestedLiteFallback: false, reason: "override-webgl" });
  expect(selectRendererAdapter(false, "webgl")).toEqual({ renderer: "webgl", requestedLiteFallback: false, reason: "override-webgl" });
  expect(selectRendererAdapter(true, "lite")).toEqual({ renderer: "lite", requestedLiteFallback: false, reason: "override-lite" });
  expect(selectRendererAdapter(false, "lite")).toEqual({ renderer: "webgl", requestedLiteFallback: true, reason: "override-lite-no-webgpu" });
});
