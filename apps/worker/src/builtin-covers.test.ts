import { describe, expect, test } from "bun:test";
import { renderCoverSvg } from "digipology-covers";

import {
  BUILTIN_COVER_SPECS,
  BUILTIN_COVER_VERSION,
  getBuiltinCover,
} from "./builtin-covers";

describe("built-in covers", () => {
  test("renders every committed CoverSpec with the portrait viewBox", () => {
    expect(Object.keys(BUILTIN_COVER_SPECS)).toEqual([
      "first-deal",
      "dice-dash",
      "zone-runner",
    ]);
    for (const [slug, spec] of Object.entries(BUILTIN_COVER_SPECS)) {
      expect(renderCoverSvg(spec, { title: slug, tagline: "Playable tabletop" }))
        .toContain('viewBox="0 0 336 504"');
      expect(getBuiltinCover(slug)?.body).toContain('viewBox="0 0 336 504"');
      expect(getBuiltinCover(slug)?.version).toBe(BUILTIN_COVER_VERSION);
    }
  });

  test("pins the single cache rollover for the third built-in", () => {
    expect(BUILTIN_COVER_VERSION).toBe(3);
    expect(getBuiltinCover("zone-runner")).toMatchObject({
      contentType: "image/svg+xml",
      version: 3,
    });
  });
});
