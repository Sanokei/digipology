import { sha256 } from "digipology-canonical-json";
import {
  inspectRasterImage, normalizeArtworkCredits, normalizeRasterArtworkInfo,
  RASTER_COVER_HEIGHT, RASTER_COVER_MAX_BYTES, RASTER_COVER_WIDTH,
  type ArtworkCredits, type DraftArtwork, type ReadyDraftArtwork, type RasterArtworkInfo,
} from "digipology-protocol";

const SOURCE_LIMIT = 8 * 1024 * 1024;
export const ARTWORK_MATTE = "#faf7ee";
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

export function artworkBlob(artwork: ReadyDraftArtwork): Blob {
  return new Blob([new Uint8Array(artworkBytes(artwork)).buffer], { type: artwork.info.contentType });
}

export async function verifyArtwork(artwork: ReadyDraftArtwork): Promise<void> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(artworkBlob(artwork), { imageOrientation: "from-image" }); }
  catch { throw new Error("This image could not be decoded. Choose another image."); }
  try { if (bitmap.width !== artwork.info.width || bitmap.height !== artwork.info.height) throw new Error("The saved image dimensions changed. Choose another image."); }
  finally { bitmap.close(); }
}

export async function prepareArtwork(file: File, credits: ArtworkCredits): Promise<ReadyDraftArtwork> {
  if (!file.size || file.size > SOURCE_LIMIT) throw new Error("Choose an image or saved artwork file smaller than 8 MiB.");
  if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("This saved artwork file could not be read."); }
    const saved = parsed?.kind === "digipology-cover" && parsed.version === 1 ? normalizeDraftArtwork(parsed.artwork) : undefined;
    if (saved?.status !== "ready") throw new Error("The saved artwork is incomplete. Choose the original image instead.");
    await verifyArtwork(saved);
    return saved;
  }
  const source = new Uint8Array(await file.arrayBuffer());
  const header = inspectRasterImage(source);
  if (!header) throw new Error("Choose a complete PNG, JPEG or WebP image. SVG and animated images are not supported here.");
  if (header.width > 8192 || header.height > 8192 || header.width * header.height > 16_000_000 || header.width < 256 || header.height < 256) throw new Error("Choose an image at least 256 × 256, no more than 8192 per side and 16 megapixels.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([source], { type: header.contentType }), { imageOrientation: "from-image" }); }
  catch { throw new Error("This image could not be decoded. Choose another image."); }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = RASTER_COVER_WIDTH; canvas.height = RASTER_COVER_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable in this browser.");
    context.fillStyle = ARTWORK_MATTE; context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = canvas.width / scale, height = canvas.height / scale;
    context.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((output) => output ? resolve(output) : reject(new Error("The image could not be prepared.")), "image/webp", 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const output = inspectRasterImage(bytes);
    if (!output || bytes.length > RASTER_COVER_MAX_BYTES) throw new Error("This image could not fit the 512 KiB cover budget. Choose a less detailed or smaller image.");
    const info: RasterArtworkInfo = { formatVersion: 1, ...output, sha256: artworkHash(bytes), credits };
    return { status: "ready", info, dataUrl: artworkDataUrl(bytes, output.contentType), source: { name: file.name.slice(0, 180), width: bitmap.width, height: bitmap.height, bytes: file.size } };
  } finally { bitmap.close(); }
}

export function artworkPackage(artwork: ReadyDraftArtwork): string {
  // Public packages omit the original local filename and source-file dimensions.
  return JSON.stringify({ kind: "digipology-cover", version: 1, artwork: { status: "ready", info: artwork.info, dataUrl: artwork.dataUrl } }, null, 2);
}

/** Fetch only the versioned same-origin cover, checking its persisted integrity. */
export async function fetchPublishedArtwork(url: string, info: RasterArtworkInfo): Promise<ReadyDraftArtwork> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("The image is unavailable. Retry loading the artwork.");
  const blob = await response.blob();
  if (blob.size > RASTER_COVER_MAX_BYTES || blob.type.split(";")[0] !== info.contentType) throw new Error("The saved image does not match its artwork information.");
  const artwork: ReadyDraftArtwork = { status: "ready", info, dataUrl: artworkDataUrl(new Uint8Array(await blob.arrayBuffer()), info.contentType) };
  await verifyArtwork(artwork);
  return artwork;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
