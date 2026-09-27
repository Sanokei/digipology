import { BUILTIN_GAMES } from "digipology-demo-games";
import { renderCoverSvg, type CoverSpec } from "digipology-covers";

export interface BuiltinCover {
  contentType: "image/svg+xml";
  body: string;
  version: number;
}

export const BUILTIN_COVER_SPECS: Readonly<Record<string, CoverSpec>> = Object.freeze(
  Object.fromEntries(BUILTIN_GAMES.map((game) => [game.slug, game.coverSpec])),
);

/** Bumped whenever committed builtin cover art changes, so `?v=` immutable caches roll over. */
export const BUILTIN_COVER_VERSION = 5;

const coverText = new Map(BUILTIN_GAMES.map((game) => [
  game.slug,
  { title: game.title, tagline: game.tagline },
]));

const covers: Readonly<Record<string, BuiltinCover>> = Object.freeze(Object.fromEntries(
  Object.entries(BUILTIN_COVER_SPECS).map(([slug, spec]) => {
    const text = coverText.get(slug);
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
