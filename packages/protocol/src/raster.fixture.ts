// Test fixture: a complete, decodable, uniformly colored RGBA PNG.
import { deflateSync } from "node:zlib";
import { crc32 } from "./raster";

export function rasterPng(width: number, height: number, color = [40, 90, 60, 255]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8);
    view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4)));
    return bytes;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(color, y * (width * 4 + 1) + 1 + x * 4);
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((size, item) => size + item.length, 0));
  let offset = 0; for (const item of chunks) { result.set(item, offset); offset += item.length; }
  return result;
}
