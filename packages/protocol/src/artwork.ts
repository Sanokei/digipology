import type { RasterContentType } from "./raster";
import { normalizeArtworkGenerationProvenance, type ArtworkGenerationProvenance } from "./art-generation";

export const RASTER_COVER_MAX_BYTES = 512 * 1024;
export const RASTER_COVER_WIDTH = 768;
export const RASTER_COVER_HEIGHT = 1152;
export const COVER_CREDITS_HEADER = "X-Digipology-Cover-Credits";
export const COVER_GENERATION_HEADER = "X-Digipology-Cover-Generation";

export interface ArtworkCredits { artist: string; license: string; sourceUrl: string }
export interface RasterArtworkInfo {
  formatVersion: 1;
  contentType: RasterContentType;
  width: number;
  height: number;
  sha256: string;
  credits: ArtworkCredits;
  generation?: ArtworkGenerationProvenance;
}
export interface ReadyDraftArtwork {
  status: "ready";
  info: RasterArtworkInfo;
  dataUrl: string;
  /** Local provenance is retained in backups, never sent to the public cover API. */
  source?: { name: string; width: number; height: number; bytes: number; sha256?: string; recipe?: string };
}
export type DraftArtwork = ReadyDraftArtwork | { status: "unavailable"; credits?: ArtworkCredits };
export interface CoverInfoResponse { coverVersion: number; artwork: RasterArtworkInfo | null }

export function normalizeArtworkCredits(value: unknown): ArtworkCredits | null {
  if (value === undefined) return { artist: "", license: "", sourceUrl: "" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["artist", "license", "sourceUrl"].includes(key))) return null;
  const read = (key: string, max: number) => typeof raw[key] === "string" && raw[key].length <= max ? raw[key].trim().replaceAll(/\s+/g, " ") : null;
  const artist = read("artist", 120), license = read("license", 80), sourceUrl = read("sourceUrl", 512);
  if (artist === null || license === null || sourceUrl === null) return null;
  if (sourceUrl) {
    try { const url = new URL(sourceUrl); if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null; }
    catch { return null; }
  }
  return { artist, license, sourceUrl };
}

export function normalizeRasterArtworkInfo(value: unknown): RasterArtworkInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const credits = normalizeArtworkCredits(raw.credits);
  const generation = raw.generation === undefined ? null : normalizeArtworkGenerationProvenance(raw.generation);
  if (raw.generation !== undefined && !generation) return null;
  if (raw.formatVersion !== 1 || typeof raw.contentType !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(raw.contentType) ||
    !Number.isSafeInteger(raw.width) || !Number.isSafeInteger(raw.height) ||
    (raw.width as number) < 1 || (raw.height as number) < 1 || (raw.width as number) > 4096 || (raw.height as number) > 4096 ||
    (raw.width as number) * 3 !== (raw.height as number) * 2 || typeof raw.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.sha256) || !credits) return null;
  return { formatVersion: 1, contentType: raw.contentType as RasterContentType, width: raw.width as number, height: raw.height as number, sha256: raw.sha256, credits,
    ...(generation ? { generation } : {}) };
}
