import { inspectRasterImage, type ReadyDraftArtwork } from "digipology-protocol";
import { artworkHash, prepareArtwork } from "../editor/state/artwork";
import { SOURCE_LIMIT } from "../editor/state/artworkData";
import type { ArtPurpose, GeneratedArtwork } from "./model";
import { assertVisibleRasterSignal } from "./rasterSignal";

/** Treat the API's image bytes as untrusted until admission and actual decoding. */
export async function prepareGeneratedArtwork(raw: GeneratedArtwork, purpose: ArtPurpose): Promise<ReadyDraftArtwork> {
  if (!raw || typeof raw.dataUrl !== "string" || !Number.isSafeInteger(raw.byteLength) || raw.byteLength <= 0 || raw.byteLength > SOURCE_LIMIT ||
      typeof raw.originalSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.originalSha256)) throw new Error("The artwork response did not contain a complete original image. Retry this image; your game is preserved.");
  if (raw.dataUrl.length > SOURCE_LIMIT * 4 / 3 + 128) throw new Error("The generated image exceeds the original-image budget. Your rules are preserved.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw.dataUrl);
  if (!match || match[1] !== raw.contentType) throw new Error("The generated image format does not match its bytes.");
  let decoded: string;
  try { decoded = atob(match[2]!); } catch { throw new Error("The generated image bytes could not be read. Retry this image."); }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const header = inspectRasterImage(bytes);
  if (!header || header.contentType !== raw.contentType || header.width !== raw.width || header.height !== raw.height ||
      bytes.length !== raw.byteLength || artworkHash(bytes) !== raw.originalSha256) {
    throw new Error("The generated image is incomplete or changed. Retry this image; your game is preserved.");
  }
  if (header.width > 8192 || header.height > 8192 || header.width * header.height > 16_000_000 || header.width < 256 || header.height < 256) throw new Error("The generated image dimensions exceed the preparation budget. Retry this image.");
  const file = new File([bytes], `${purpose}.${raw.contentType.split("/")[1]}`, { type: raw.contentType });
  await assertVisibleRasterSignal(file);
  const artwork = await prepareArtwork(file, raw.credits, purpose === "card-back" ? "contain" : "cover");
  return { ...artwork, info: { ...artwork.info, generation: {
    model: raw.model, promptHash: raw.promptHash, originalSha256: raw.originalSha256, generatedAt: raw.generatedAt,
  } } };
}
