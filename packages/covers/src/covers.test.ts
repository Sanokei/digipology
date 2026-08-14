import { describe, expect, test } from "bun:test";
import {
  COVER_LAYOUTS,
  COVER_MOTIFS,
  TITLE_TREATMENTS,
  normalizeCoverSpec,
  renderCoverSvg,
  seededSpec,
  type CoverSpec,
} from "./index";

const FIXED_SPEC: CoverSpec = {
  palette: ["#101820", "#f2aa4c", "#d64045", "#f7f7ff"],
  layout: "diagonal",
  motif: "cards",
  titleTreatment: "underlined",
  seed: 424242,
};

describe("normalizeCoverSpec", () => {
  const base = { ...FIXED_SPEC };
  for (const [label, value] of [
    ["short hex", { ...base, palette: ["#12345", "#abcdef"] }],
    ["named color", { ...base, palette: ["red", "#abcdef"] }],
    ["non-hex color", { ...base, palette: ["#GGGGGG", "#abcdef"] }],
    ["unknown layout", { ...base, layout: "poster" }],
    ["unknown motif", { ...base, motif: "chess" }],
    ["unknown treatment", { ...base, titleTreatment: "glowing" }],
    ["one color", { ...base, palette: ["#abcdef"] }],
    ["five colors", { ...base, palette: ["#000000", "#111111", "#222222", "#333333", "#444444"] }],
    ["non-finite seed", { ...base, seed: Number.NaN }],
    ["infinite seed", { ...base, seed: Number.POSITIVE_INFINITY }],
    ["extra field", { ...base, surprise: true }],
  ] as const) {
    test(`rejects ${label}`, () => expect(normalizeCoverSpec(value)).toBeNull());
  }

  test("accepts palette boundaries, normalizes uppercase, and floors/absolves the seed", () => {
    expect(normalizeCoverSpec({ ...base, palette: ["#ABCDEF", "#012345"], seed: -42.9 })).toEqual({
      ...base,
      palette: ["#abcdef", "#012345"],
      seed: 43,
    });
    expect(normalizeCoverSpec({ ...base, palette: ["#000000", "#333333", "#aaaaaa", "#ffffff"] }))
      .toEqual({ ...base, palette: ["#000000", "#333333", "#aaaaaa", "#ffffff"] });
  });
});

describe("renderCoverSvg", () => {
  test("matches the golden digest and is byte-identical across repeated renders", () => {
    const text = { title: "Signal & Shuffle", tagline: "Plan < draw > win" };
    const first = renderCoverSvg(FIXED_SPEC, text);
    const second = renderCoverSvg(structuredClone(FIXED_SPEC), { ...text });
    expect(first).toBe(second);
    expect(first.length).toBe(1810);
    expect(new Bun.CryptoHasher("sha256").update(first).digest("hex"))
      .toBe("2215a094e935a61d36712e6245a24d8f7c1f7cb75b1dd28c25c2fe1f8bbea7c9");
    expect(renderCoverSvg({ ...FIXED_SPEC, seed: FIXED_SPEC.seed + 1 }, text)).not.toBe(first);
  });

  test("is safe by construction across the grammar and hostile plain text", () => {
    const forbidden = [/<script/i, /<foreignObject/i, /javascript:/i, /xlink:href/i, /\shref=/i, /\son[a-z-]*=/i, /url\(/i];
    for (const [layoutIndex, layout] of COVER_LAYOUTS.entries()) {
      for (const [motifIndex, motif] of COVER_MOTIFS.entries()) {
        const spec: CoverSpec = {
          ...FIXED_SPEC,
          layout,
          motif,
          titleTreatment: TITLE_TREATMENTS[(layoutIndex + motifIndex) % TITLE_TREATMENTS.length]!,
          seed: layoutIndex * 100 + motifIndex,
        };
        const svg = renderCoverSvg(spec, {
          title: '</text><script>alert(1)</script> href="https://evil" onclick="steal()"',
          tagline: "<foreignObject>javascript: xlink:href='bad' onload='bad'",
        });
        expect(svg).toContain('viewBox="0 0 336 504"');
        expect(svg).toContain("&lt;/text&gt;&lt;script&gt;");
        for (const pattern of forbidden) expect(svg).not.toMatch(pattern);
        const tags = new Set(Array.from(svg.matchAll(/<\/?([a-z]+)/gi), (match) => match[1]!.toLowerCase()));
        expect([...tags].sort()).toEqual(expect.arrayContaining(["circle", "rect", "svg", "text"]));
        expect([...tags].every((tag) => ["circle", "g", "line", "path", "polygon", "rect", "svg", "text"].includes(tag))).toBe(true);
      }
    }
  });
});

describe("seededSpec", () => {
  test("is stable, distinct across a corpus, and varies structural choices", () => {
    const slugs = Array.from({ length: 100 }, (_, index) =>
      `${["cards", "dice", "garden", "orbit", "market"][index % 5]}-${index + 1}-night`);
    const specs = slugs.map(seededSpec);
    expect(seededSpec(slugs[37]!)).toEqual(specs[37]!);
    expect(new Set(specs.map((spec) => JSON.stringify(spec))).size).toBe(slugs.length);
    expect(new Set(specs.map((spec) => spec.layout)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(specs.map((spec) => spec.motif)).size).toBeGreaterThanOrEqual(3);
    for (const spec of specs) expect(normalizeCoverSpec(spec)).toEqual(spec);
  });
});
