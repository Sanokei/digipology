import {
  COVER_LAYOUTS,
  COVER_MOTIFS,
  TITLE_TREATMENTS,
  type CoverSpec,
} from "./spec";

/** Creates a stable, visually varied CoverSpec from a slug. */
export function seededSpec(slug: string): CoverSpec {
  const seed = avalanche(fnv1a(slug.trim().toLowerCase() || "untitled"));
  const secondary = avalanche(seed ^ 0x9e37_79b9);
  const hue = seed % 360;
  const spread = 42 + (secondary % 91);
  return {
    palette: [
      hslHex((hue + 344) % 360, 42 + (seed % 15), 10 + (secondary % 7)),
      hslHex(hue, 69 + (secondary % 18), 56 + (seed % 10)),
      hslHex((hue + spread) % 360, 66 + (seed % 20), 68 + (secondary % 10)),
      hslHex((hue + 180 + (secondary % 37)) % 360, 35 + (seed % 20), 92),
    ],
    layout: COVER_LAYOUTS[seed % COVER_LAYOUTS.length]!,
    motif: COVER_MOTIFS[(seed >>> 5) % COVER_MOTIFS.length]!,
    titleTreatment: TITLE_TREATMENTS[(secondary >>> 7) % TITLE_TREATMENTS.length]!,
    seed,
  };
}

function fnv1a(value: string): number {
  let hash = 0x811c_9dc5;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    hash ^= point & 0xff;
    hash = Math.imul(hash, 0x0100_0193);
    hash ^= point >>> 8;
    hash = Math.imul(hash, 0x0100_0193);
    hash ^= point >>> 16;
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

function avalanche(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb_352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846c_a68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function hslHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = s === 0
    ? [l, l, l]
    : [hueChannel(p, q, h + 1 / 3), hueChannel(p, q, h), hueChannel(p, q, h - 1 / 3)];
  return `#${channels.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}

function hueChannel(p: number, q: number, input: number): number {
  let t = input;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
