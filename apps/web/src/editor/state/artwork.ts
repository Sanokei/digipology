import { parseCardDesigns } from "digipology-protocol";
import { sha256 } from "digipology-canonical-json";
import {
  inspectRasterImage,
  RASTER_COVER_HEIGHT, RASTER_COVER_MAX_BYTES, RASTER_COVER_WIDTH,
  type ArtworkCredits, type DraftArtwork, type ReadyDraftArtwork, type RasterArtworkInfo,
} from "digipology-protocol";

import { SOURCE_LIMIT, artworkBytes, artworkDataUrl, artworkHash, normalizeDraftArtwork } from "./artworkData";
export { artworkBytes, artworkDataUrl, artworkHash, normalizeDraftArtwork, EMPTY_CREDITS } from "./artworkData";
export const ARTWORK_MATTE = "#faf7ee";

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

export async function prepareArtwork(file: File, credits: ArtworkCredits, fit: "cover" | "contain" = "cover", profile: "portrait" | "illustration" | "card-back" = "portrait"): Promise<ReadyDraftArtwork> {
  if (!file.size || file.size > SOURCE_LIMIT) throw new Error("Choose an image or saved artwork file smaller than 8 MiB.");
  if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("This saved artwork file could not be read."); }
    let cardImage: ReadyDraftArtwork | undefined;
    if (parsed?.kind === "digipology-card-image" && parsed.version === 1) {
      cardImage = parseCardDesigns(JSON.stringify({ kind: "digipology-card-designs", version: 1, families: [], cards: [], decks: [], assets: [{ id: "import", purpose: parsed.purpose, artwork: parsed.artwork }] }), sha256).assets[0]!.artwork;
      if (profile === "illustration" ? cardImage.info.width * 2 !== cardImage.info.height * 3 : cardImage.info.width * 3 !== cardImage.info.height * 2) throw new Error("Choose an image package matching this illustration or back window.");
    }
    const saved = cardImage ?? ((parsed?.kind === "digipology-cover" || parsed?.kind === "digipology-card-back") && parsed.version === 1 ? normalizeDraftArtwork(parsed.artwork) : undefined);
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
    canvas.width = profile === "card-back" ? 512 : RASTER_COVER_WIDTH; canvas.height = profile === "illustration" ? 512 : profile === "card-back" ? 768 : RASTER_COVER_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable in this browser.");
    context.fillStyle = ARTWORK_MATTE; context.fillRect(0, 0, canvas.width, canvas.height);
    if (fit === "contain") {
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const width = bitmap.width * scale, height = bitmap.height * scale;
      context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    } else {
      const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const width = canvas.width / scale, height = canvas.height / scale;
      context.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((output) => output ? resolve(output) : reject(new Error("The image could not be prepared.")), "image/webp", profile === "portrait" ? 0.9 : 0.84));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const output = inspectRasterImage(bytes);
    if (!output || bytes.length > (profile !== "portrait" ? 256 * 1024 : RASTER_COVER_MAX_BYTES)) throw new Error("This image could not fit the image budget. Choose a less detailed or smaller image.");
    const info: RasterArtworkInfo = { formatVersion: 1, ...output, sha256: artworkHash(bytes), credits };
    return { status: "ready", info, dataUrl: artworkDataUrl(bytes, output.contentType), source: { name: file.name.slice(0, 180), width: bitmap.width, height: bitmap.height, bytes: file.size, sha256: artworkHash(source), recipe: `Canvas oriented decode; ${fit}; ${canvas.width}x${canvas.height}; matte ${ARTWORK_MATTE}; WebP quality ${profile === "portrait" ? "0.90" : "0.84"}.` } };
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
