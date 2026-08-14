import { describe, expect, test } from "bun:test";
import { COVER_BODY_LIMIT, validateCoverImage } from "./cover-image";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, height >>> 8, height & 255, width >>> 8, width & 255]);
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 255, (w >>> 8) & 255, (w >>> 16) & 255], 24);
  bytes.set([h & 255, (h >>> 8) & 255, (h >>> 16) & 255], 27);
  return bytes;
}

describe("cover image validation", () => {
  test("accepts complete 2:3 PNG, JPEG, and WebP headers", () => {
    expect(validateCoverImage(png(336, 504), "image/png")).toMatchObject({ ok: true, contentType: "image/png" });
    expect(validateCoverImage(jpeg(336, 504), "image/jpeg")).toMatchObject({ ok: true, contentType: "image/jpeg" });
    expect(validateCoverImage(webp(336, 504), "image/webp")).toMatchObject({ ok: true, contentType: "image/webp" });
  });

  test("rejects wrong magic, truncation, dimensions, ratio, and Content-Type spoofing", () => {
    for (const [bytes, type] of [
      [new Uint8Array([1, 2, 3]), "image/png"],
      [png(336, 504).subarray(0, 20), "image/png"],
      [png(4097, 6146), "image/png"],
      [png(336, 500), "image/png"],
      [png(336, 504), "image/jpeg"],
    ] as const) expect(validateCoverImage(bytes, type).ok).toBe(false);
  });

  test("pins the binary route body budget", () => {
    expect(COVER_BODY_LIMIT).toBe(512 * 1024);
  });
});
