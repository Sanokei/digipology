import { expect, test } from "bun:test";
import { hasVisibleRasterSignal } from "./rasterSignal";

const pixels = (colors: readonly (readonly number[])[]) => new Uint8ClampedArray(colors.flatMap((color) => [...color]));

test("fully transparent output is rejected even when its hidden RGB values differ", () => {
  expect(hasVisibleRasterSignal(pixels([[0, 0, 0, 0], [255, 0, 0, 0], [0, 255, 0, 0], [255, 255, 255, 0]]))).toBe(false);
});

test("uniform opaque and barely visible rasters are rejected as blank admission results", () => {
  expect(hasVisibleRasterSignal(pixels(Array.from({ length: 8 }, () => [120, 80, 20, 255])))).toBe(false);
  expect(hasVisibleRasterSignal(pixels([[0, 0, 0, 1], [255, 255, 255, 1], [255, 0, 0, 1], [0, 0, 255, 1]]))).toBe(false);
});

test("visible color structure can be admitted without claiming it is good artwork", () => {
  expect(hasVisibleRasterSignal(pixels([[30, 45, 60, 255], [220, 200, 120, 255], [30, 45, 60, 255], [220, 200, 120, 255]]))).toBe(true);
});
