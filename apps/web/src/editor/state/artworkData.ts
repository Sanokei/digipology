import { sha256 } from "digipology-canonical-json";
import { inspectRasterImage, normalizeArtworkCredits, normalizeRasterArtworkInfo, RASTER_COVER_MAX_BYTES, type ArtworkCredits, type DraftArtwork, type ReadyDraftArtwork } from "digipology-protocol";

export const SOURCE_LIMIT = 8 * 1024 * 1024;
export const EMPTY_CREDITS: ArtworkCredits = { artist: "", license: "", sourceUrl: "" };
export const artworkHash = (bytes: Uint8Array) => `sha256:${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

export function artworkDataUrl(bytes: Uint8Array, type: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096) binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return `data:${type};base64,${btoa(binary)}`;
}

export function artworkBytes(artwork: ReadyDraftArtwork): Uint8Array {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(artwork.dataUrl);
  if (!match || match[1] !== artwork.info.contentType || artwork.dataUrl.length > RASTER_COVER_MAX_BYTES * 4 / 3 + 128) throw new Error("The saved artwork could not be read.");
  const binary = atob(match[2]!);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const image = inspectRasterImage(bytes);
  if (bytes.length > RASTER_COVER_MAX_BYTES || !image || image.contentType !== artwork.info.contentType || image.width !== artwork.info.width || image.height !== artwork.info.height || artworkHash(bytes) !== artwork.info.sha256) throw new Error("The saved artwork is incomplete or changed.");
  return bytes;
}

export function normalizeDraftArtwork(value: unknown): DraftArtwork | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const info = normalizeRasterArtworkInfo(raw.info);
  const rawInfo = raw.info && typeof raw.info === "object" ? raw.info as Record<string, unknown> : null;
  const credits = info?.credits ?? normalizeArtworkCredits(rawInfo?.credits ?? raw.credits) ?? undefined;
  const unavailable: DraftArtwork = { status: "unavailable", ...(credits ? { credits } : {}) };
  if (raw.status !== "ready" || !info || typeof raw.dataUrl !== "string") return unavailable;
  const ready: ReadyDraftArtwork = { status: "ready", info, dataUrl: raw.dataUrl };
  try { artworkBytes(ready); } catch { return unavailable; }
  const source = raw.source as Record<string, unknown> | undefined;
  if (source && typeof source.name === "string" && source.name.length <= 180 && Number.isSafeInteger(source.width) && Number.isSafeInteger(source.height) && Number.isSafeInteger(source.bytes) &&
    (source.width as number) > 0 && (source.height as number) > 0 && (source.width as number) <= 8192 && (source.height as number) <= 8192 && (source.bytes as number) > 0 && (source.bytes as number) <= SOURCE_LIMIT) {
    ready.source = { name: source.name.split(/[/\\]/).at(-1)!, width: source.width as number, height: source.height as number, bytes: source.bytes as number };
  }
  return ready;
}
