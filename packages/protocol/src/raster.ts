export type RasterContentType = "image/png" | "image/jpeg" | "image/webp";

/** Static container admission. Browser decoding is additionally required for imported artwork. */
export function inspectRasterImage(bytes: Uint8Array):
  | { contentType: RasterContentType; width: number; height: number }
  | null {
  return parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}

function parsePng(bytes: Uint8Array): { contentType: "image/png"; width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 57 || !signature.every((byte, index) => bytes[index] === byte)) return null;
  if (readU32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = readU32BE(bytes, 16), height = readU32BE(bytes, 20);
  if (!width || !height) return null;
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25] ?? -1]?.includes(bytes[24] ?? -1) || bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) return null;
  let imageData = false, endedData = false, palette = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = readU32BE(bytes, offset);
    if (length === null || length > bytes.length - offset - 12) return null;
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 8 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end)) !== readU32BE(bytes, end)) return null;
    if (["acTL", "fcTL", "fdAT"].includes(type) || (type === "IHDR" && offset !== 8)) return null;
    if (type === "PLTE") { if (imageData || length === 0 || length > 768 || length % 3 !== 0) return null; palette = true; }
    if (type === "IDAT") { if (endedData) return null; imageData ||= length > 0; }
    else if (imageData) endedData = true;
    offset = end + 4;
    if (type === "IEND") return length === 0 && imageData && (bytes[25] !== 3 || palette) && offset === bytes.length ? { contentType: "image/png", width, height } : null;
    if (!["IHDR", "PLTE", "IDAT"].includes(type) && type.charCodeAt(0) < 97) return null;
  }
  return null;
}

/** PNG chunk CRC, over the type and payload bytes. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseJpeg(bytes: Uint8Array): { contentType: "image/jpeg"; width: number; height: number } | null {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let dimensions: { contentType: "image/jpeg"; width: number; height: number } | null = null;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return null;
    if (marker === 0xda) {
      const scanLength = readU16BE(bytes, offset);
      return scanLength !== null && scanLength >= 6 && offset + scanLength < bytes.length - 2 ? dimensions : null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = readU16BE(bytes, offset);
    if (length === null || length < 2 || offset + length > bytes.length) return null;
    if (isSofMarker(marker)) {
      if (length < 7) return null;
      const height = readU16BE(bytes, offset + 3);
      const width = readU16BE(bytes, offset + 5);
      if (!width || !height) return null;
      dimensions = { contentType: "image/jpeg", width, height };
    }
    offset += length;
  }
  return null;
}

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function parseWebp(bytes: Uint8Array): { contentType: "image/webp"; width: number; height: number } | null {
  if (bytes.length < 26 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const riffSize = readU32LE(bytes, 4);
  if (riffSize === null || riffSize + 8 !== bytes.length || riffSize % 2) return null;
  let dimensions: { width: number; height: number } | null = null;
  let extended: { width: number; height: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4), size = readU32LE(bytes, offset + 4);
    if (size === null || size > bytes.length - offset - 8) return null;
    const data = offset + 8, next = data + size + (size & 1);
    if (next > bytes.length || (size & 1) && bytes[next - 1] !== 0) return null;
    if (["ANIM", "ANMF"].includes(type)) return null;
    if (type === "VP8X") {
      if (offset !== 12 || size !== 10 || ((bytes[data] ?? 0) & 0x02)) return null;
      extended = { width: readU24LE(bytes, data + 4)! + 1, height: readU24LE(bytes, data + 7)! + 1 };
    } else if (type === "VP8L") {
      if (dimensions || size <= 5 || bytes[data] !== 0x2f) return null;
      const bits = readU32LE(bytes, data + 1)!;
      if (bits >>> 29) return null;
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (type === "VP8 ") {
      if (dimensions || size <= 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
      dimensions = { width: readU16LE(bytes, data + 6)! & 0x3fff, height: readU16LE(bytes, data + 8)! & 0x3fff };
    }
    offset = next;
  }
  if (offset !== bytes.length || !dimensions?.width || !dimensions.height || extended && (extended.width !== dimensions.width || extended.height !== dimensions.height)) return null;
  return { contentType: "image/webp", ...dimensions };
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
