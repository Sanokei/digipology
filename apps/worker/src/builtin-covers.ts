import { renderCoverSvg, type CoverSpec } from "digipology-covers";

export interface BuiltinCover {
  contentType: "image/svg+xml";
  body: string;
  version: number;
}

export const BUILTIN_COVER_SPECS: Readonly<Record<string, CoverSpec>> = Object.freeze({
  "first-deal": {
    palette: ["#0b0b0f", "#f3a53b", "#8b5cf6", "#f3f3f5"],
    layout: "banded",
    motif: "cards",
    titleTreatment: "underlined",
    seed: 1_031_991,
  },
  "dice-dash": {
    palette: ["#0b0b0f", "#f3a53b", "#22c55e", "#f3f3f5"],
    layout: "diagonal",
    motif: "dice",
    titleTreatment: "boxed",
    seed: 4_204_202,
  },
  "zone-runner": {
    palette: ["#0b0b0f", "#f3a53b", "#38bdf8", "#f3f3f5"],
    layout: "radial",
    motif: "meeples",
    titleTreatment: "stacked",
    seed: 6_600_166,
  },
});

/** Bumped whenever committed builtin cover art changes, so `?v=` immutable caches roll over. */
export const BUILTIN_COVER_VERSION = 3;

const coverText: Readonly<Record<string, { title: string; tagline: string }>> = Object.freeze({
  "first-deal": {
    title: "First Deal",
    tagline: "Shuffle, deal, draw, flip, and move a full deck together.",
  },
  "dice-dash": {
    title: "Dice Dash",
    tagline: "Race to 20 on deterministic rolls from the shared table.",
  },
  "zone-runner": {
    title: "Zone Runner",
    tagline: "Race pieces into scoring zones before the turn timer runs out.",
  },
});

const covers: Readonly<Record<string, BuiltinCover>> = Object.freeze(Object.fromEntries(
  Object.entries(BUILTIN_COVER_SPECS).map(([slug, spec]) => {
    const text = coverText[slug];
    if (text === undefined) throw new Error(`Missing built-in cover text for ${slug}`);
    return [slug, {
      contentType: "image/svg+xml" as const,
      body: renderCoverSvg(spec, text),
      version: BUILTIN_COVER_VERSION,
    }];
  }),
));

export function getBuiltinCover(slug: string): BuiltinCover | null {
  return covers[slug] ?? null;
}
