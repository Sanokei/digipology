import { inspectRasterImage, type RasterContentType } from "digipology-protocol";
export const COVER_BODY_LIMIT = 512 * 1024;
export const COVER_MAX_DIMENSION = 4096;

export type CoverContentType = RasterContentType;

export type CoverValidationResult =
  | { ok: true; contentType: CoverContentType; width: number; height: number }
  | { ok: false; code: "invalid_cover"; message: string };

export function validateCoverImage(
  bytes: Uint8Array,
  claimedContentType: string | null,
): CoverValidationResult {
  const parsed = inspectRasterImage(bytes);
  if (parsed === null) return invalid("Cover must be a complete PNG, JPEG, or WebP image");
  const claimed = claimedContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (claimed !== undefined && claimed !== "" && claimed !== parsed.contentType) {
    return invalid("Content-Type does not match the image bytes");
  }
  if (parsed.width < 1 || parsed.height < 1 ||
      parsed.width > COVER_MAX_DIMENSION || parsed.height > COVER_MAX_DIMENSION) {
    return invalid(`Cover dimensions must be between 1 and ${COVER_MAX_DIMENSION} pixels`);
  }
  if (parsed.width * 3 !== parsed.height * 2) {
    return invalid("Cover dimensions must use a 2:3 portrait aspect ratio");
  }
  return { ok: true, ...parsed };
}

function invalid(message: string): CoverValidationResult {
  return { ok: false, code: "invalid_cover", message };
}
