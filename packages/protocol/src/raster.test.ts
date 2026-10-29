import { expect, test } from "bun:test";
import { inspectRasterImage } from "./raster";
import { rasterPng } from "./raster.fixture";

test("PNG admission checks data, terminal chunks, CRC and static format", () => {
  const png = rasterPng(4, 6);
  expect(inspectRasterImage(png)).toEqual({ contentType: "image/png", width: 4, height: 6 });
  for (const broken of [png.slice(0, 33), png.slice(0, -1), png.slice(0, -12), new Uint8Array([...png, 0])]) expect(inspectRasterImage(broken)).toBeNull();
  const damaged = png.slice(); damaged[damaged.length - 18]! ^= 1;
  expect(inspectRasterImage(damaged)).toBeNull();
});

test("WebP extended headers and JPEG dimensions alone are not image data", async () => {
  const header = new Uint8Array(30);
  header.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10]);
  expect(inspectRasterImage(header)).toBeNull();
  expect(inspectRasterImage(new Uint8Array([255, 216, 255, 192, 0, 7, 8, 1, 248, 1, 80, 255, 217]))).toBeNull();
  const real = new Uint8Array(await Bun.file(new URL("../../../apps/web/public/art/first-deal.webp", import.meta.url)).arrayBuffer());
  expect(inspectRasterImage(real)).toEqual({ contentType: "image/webp", width: 1024, height: 1536 });
  expect(inspectRasterImage(real.slice(0, -2))).toBeNull();
});
