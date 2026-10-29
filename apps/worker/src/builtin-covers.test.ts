import { expect, test } from "bun:test";
import { BUILTIN_COVER_VERSION, getBuiltinCover } from "./builtin-covers";
import { validateCoverImage, COVER_BODY_LIMIT } from "./cover-image";

test("built-in covers are actual portrait raster illustrations within the upload budget", async () => {
  for (const slug of ["first-deal", "dice-dash", "zone-runner"]) {
    const cover = getBuiltinCover(slug)!;
    const bytes = new Uint8Array(await Bun.file(new URL(`../../web/public${cover.assetPath}`, import.meta.url)).arrayBuffer());
    expect(bytes.length).toBeLessThanOrEqual(COVER_BODY_LIMIT);
    expect(validateCoverImage(bytes, cover.contentType)).toEqual({ ok: true, contentType: "image/webp", width: 1024, height: 1536 });
    expect(cover.version).toBe(BUILTIN_COVER_VERSION);
  }
  expect(BUILTIN_COVER_VERSION).toBe(4);
  expect(getBuiltinCover("unknown")).toBeNull();
});
