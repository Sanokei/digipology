export const COVER_BODY_LIMIT = 512 * 1024;
export const COVER_MAX_DIMENSION = 4096;

export type CoverContentType = "image/png" | "image/jpeg" | "image/webp";

export type CoverValidationResult =
  | { ok: true; contentType: CoverContentType; width: number; height: number }
  | { ok: false; code: "invalid_cover"; message: string };

export function validateCoverImage(
  bytes: Uint8Array,
  claimedContentType: string | null,
): CoverValidationResult {
  const parsed = parseImage(bytes);
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

function parseImage(bytes: Uint8Array):
  | { contentType: CoverContentType; width: number; height: number }
  | null {
  return parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}

function parsePng(bytes: Uint8Array): { contentType: "image/png"; width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte)) return null;
  if (readU32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width === null || height === null) return null;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = readU32BE(bytes, offset);
    if (length === null || length > bytes.length - offset - 12) return null;
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL") return null;
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return { contentType: "image/png", width, height };
}

function parseJpeg(bytes: Uint8Array): { contentType: "image/jpeg"; width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = readU16BE(bytes, offset);
    if (length === null || length < 2 || offset + length > bytes.length) return null;
    if (isSofMarker(marker)) {
      if (length < 7) return null;
      const height = readU16BE(bytes, offset + 3);
      const width = readU16BE(bytes, offset + 5);
      return width === null || height === null ? null : { contentType: "image/jpeg", width, height };
    }
    offset += length;
  }
  return null;
}

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function parseWebp(bytes: Uint8Array): { contentType: "image/webp"; width: number; height: number } | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const riffSize = readU32LE(bytes, 4);
  if (riffSize === null || riffSize + 8 > bytes.length) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length && offset + 8 <= riffSize + 8) {
    const type = ascii(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    if (size === null || size > bytes.length - offset - 8) return null;
    const data = offset + 8;
    if (type === "VP8X") {
      if (size < 10 || data + 10 > bytes.length || ((bytes[data] ?? 0) & 0x02) !== 0) return null;
      const width = readU24LE(bytes, data + 4);
      const height = readU24LE(bytes, data + 7);
      return width === null || height === null
        ? null
        : { contentType: "image/webp", width: width + 1, height: height + 1 };
    }
    if (type === "VP8L") {
      if (size < 5 || bytes[data] !== 0x2f) return null;
      const bits = readU32LE(bytes, data + 1);
      if (bits === null) return null;
      return {
        contentType: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (type === "VP8 ") {
      if (size < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        return null;
      }
      const width = readU16LE(bytes, data + 6);
      const height = readU16LE(bytes, data + 8);
      return width === null || height === null
        ? null
        : { contentType: "image/webp", width: width & 0x3fff, height: height & 0x3fff };
    }
    offset += 8 + size + (size & 1);
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 3 > bytes.length) return null;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return (((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return ((bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 3] ?? 0) * 0x1000000)) >>> 0;
}

function invalid(message: string): CoverValidationResult {
  return { ok: false, code: "invalid_cover", message };
}
