export interface BuiltinCover {
  contentType: "image/webp";
  assetPath: string;
  version: number;
}

/** Raster illustrations ship with the static app; increment when artwork changes. */
export const BUILTIN_COVER_VERSION = 4;
const covers: Readonly<Record<string, BuiltinCover>> = Object.freeze(Object.fromEntries(
  ["first-deal", "dice-dash", "zone-runner"].map((slug) => [slug, Object.freeze({
    contentType: "image/webp" as const,
    assetPath: `/art/${slug}.webp`,
    version: BUILTIN_COVER_VERSION,
  })]),
));

export function getBuiltinCover(slug: string): BuiltinCover | null {
  return covers[slug] ?? null;
}
