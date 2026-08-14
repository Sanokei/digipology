export const COVER_LAYOUTS = ["banded", "diagonal", "radial", "grid", "corner"] as const;
export const COVER_MOTIFS = ["cards", "dice", "meeples", "abstract"] as const;
export const TITLE_TREATMENTS = ["stacked", "boxed", "underlined", "minimal"] as const;

export type CoverLayout = typeof COVER_LAYOUTS[number];
export type CoverMotif = typeof COVER_MOTIFS[number];
export type TitleTreatment = typeof TITLE_TREATMENTS[number];

export interface CoverSpec {
  palette: string[];
  layout: CoverLayout;
  motif: CoverMotif;
  titleTreatment: TitleTreatment;
  seed: number;
}

const HEX = /^#[0-9a-f]{6}$/;

/** Defensively normalizes an extracted CoverSpec payload. */
export function normalizeCoverSpec(raw: unknown): CoverSpec | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "layout,motif,palette,seed,titleTreatment") return null;
  if (!Array.isArray(raw.palette) || raw.palette.length < 2 || raw.palette.length > 4) return null;
  const palette: string[] = [];
  for (const value of raw.palette) {
    if (typeof value !== "string") return null;
    const normalized = value.toLowerCase();
    if (!HEX.test(normalized)) return null;
    palette.push(normalized);
  }
  if (!includes(COVER_LAYOUTS, raw.layout) ||
      !includes(COVER_MOTIFS, raw.motif) ||
      !includes(TITLE_TREATMENTS, raw.titleTreatment) ||
      typeof raw.seed !== "number" || !Number.isFinite(raw.seed)) return null;
  const seed = Math.abs(Math.floor(raw.seed)) >>> 0;
  return {
    palette,
    layout: raw.layout,
    motif: raw.motif,
    titleTreatment: raw.titleTreatment,
    seed,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
