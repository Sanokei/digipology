import type { FaceSpec } from "./types";

export function canonicalFaceSpec(spec: FaceSpec): string {
  return stringify(spec);
}

export function faceSpecHash(spec: FaceSpec): string {
  const text = canonicalFaceSpec(spec);
  let hash = 0xcbf29ce484222325n;
  for (const byte of utf8(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `face-v1-${hash.toString(16).padStart(16, "0")}`;
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${quote(key)}:${stringify(record[key])}`).join(",")}}`;
}

function quote(value: string): string {
  let result = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"') result += '\\"';
    else if (char === "\\") result += "\\\\";
    else if (code < 0x20) result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += char;
  }
  return result + '"';
}

function utf8(value: string): number[] {
  const result: number[] = [];
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point <= 0x7f) result.push(point);
    else if (point <= 0x7ff) result.push(0xc0 | point >> 6, 0x80 | point & 0x3f);
    else if (point <= 0xffff) result.push(0xe0 | point >> 12, 0x80 | point >> 6 & 0x3f, 0x80 | point & 0x3f);
    else result.push(0xf0 | point >> 18, 0x80 | point >> 12 & 0x3f, 0x80 | point >> 6 & 0x3f, 0x80 | point & 0x3f);
  }
  return result;
}
