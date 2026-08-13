/** Reasons why a value cannot be represented by the canonical JSON format. */
export type CanonicalizationErrorReason =
  | "nan"
  | "infinity"
  | "function"
  | "undefined"
  | "cycle"
  | "non-string-key"
  | "unsupported-type";

/** Thrown when canonical serialization encounters a non-canonical value. */
export class CanonicalizationError extends Error {
  readonly path: string;
  readonly reason: CanonicalizationErrorReason;

  constructor(path: string, reason: CanonicalizationErrorReason) {
    super(`Cannot canonicalize value at ${path}: ${reason}`);
    this.name = "CanonicalizationError";
    this.path = path;
    this.reason = reason;
  }
}

const HEX = "0123456789abcdef";
const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const objectPrototype = Object.prototype;
const hasOwn = objectPrototype.hasOwnProperty;

function appendPath(path: string, key: string): string {
  if (IDENTIFIER_KEY.test(key)) {
    return `${path}.${key}`;
  }
  return `${path}[${quoteString(key)}]`;
}

function unicodeEscape(codeUnit: number): string {
  return `\\u${HEX.charAt((codeUnit >>> 12) & 0x0f)}${HEX.charAt((codeUnit >>> 8) & 0x0f)}${HEX.charAt((codeUnit >>> 4) & 0x0f)}${HEX.charAt(codeUnit & 0x0f)}`;
}

function quoteString(value: string): string {
  let result = '"';

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit === 0x22) {
      result += '\\"';
    } else if (codeUnit === 0x5c) {
      result += "\\\\";
    } else if (codeUnit < 0x20) {
      result += unicodeEscape(codeUnit);
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += String.fromCharCode(codeUnit, next);
        index += 1;
      } else {
        result += unicodeEscape(codeUnit);
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      result += unicodeEscape(codeUnit);
    } else {
      result += value[index];
    }
  }

  return `${result}"`;
}

function sortedKeys(value: object, path: string): string[] {
  const ownKeys = Reflect.ownKeys(value);
  const keys: string[] = [];

  for (const key of ownKeys) {
    if (typeof key !== "string") {
      throw new CanonicalizationError(path, "non-string-key");
    }
    keys.push(key);
  }

  keys.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return keys;
}

function propertyValue(value: object, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !("value" in descriptor)
  ) {
    throw new CanonicalizationError(path, "unsupported-type");
  }
  return descriptor.value;
}

function serializeArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
): string {
  const keys = sortedKeys(value, path);
  const expectedKeys = value.length;

  // Every array owns a non-enumerable length property. Any other key must be a
  // present element index; sparse elements and custom properties are not JSON-like.
  if (keys.length !== expectedKeys + 1 || keys[keys.length - 1] !== "length") {
    for (const key of keys) {
      if (key === "length") continue;
      const numericIndex = Number(key);
      if (
        !Number.isInteger(numericIndex) ||
        numericIndex < 0 ||
        numericIndex >= value.length ||
        String(numericIndex) !== key
      ) {
        throw new CanonicalizationError(appendPath(path, key), "unsupported-type");
      }
    }
  }

  const parts: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const itemPath = `${path}[${key}]`;
    if (!hasOwn.call(value, key)) {
      throw new CanonicalizationError(itemPath, "undefined");
    }
    parts.push(serialize(propertyValue(value, key, itemPath), itemPath, ancestors));
  }
  return `[${parts.join(",")}]`;
}

function serializeObject(
  value: object,
  path: string,
  ancestors: Set<object>,
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) {
    throw new CanonicalizationError(path, "unsupported-type");
  }

  const parts: string[] = [];
  for (const key of sortedKeys(value, path)) {
    const itemPath = appendPath(path, key);
    const item = propertyValue(value, key, itemPath);
    parts.push(`${quoteString(key)}:${serialize(item, itemPath, ancestors)}`);
  }
  return `{${parts.join(",")}}`;
}

function serialize(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (Number.isNaN(value)) {
        throw new CanonicalizationError(path, "nan");
      }
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(path, "infinity");
      }
      if (Object.is(value, -0)) return "0";
      return value.toString(10);
    case "string":
      return quoteString(value);
    case "undefined":
      throw new CanonicalizationError(path, "undefined");
    case "function":
      throw new CanonicalizationError(path, "function");
    case "bigint":
    case "symbol":
      throw new CanonicalizationError(path, "unsupported-type");
    case "object": {
      if (ancestors.has(value)) {
        throw new CanonicalizationError(path, "cycle");
      }
      ancestors.add(value);
      try {
        return Array.isArray(value)
          ? serializeArray(value, path, ancestors)
          : serializeObject(value, path, ancestors);
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new CanonicalizationError(path, "unsupported-type");
  }
}

/** Serialize a canonical-compatible value to its unique canonical string form. */
export function canonicalStringify(value: unknown): string {
  return serialize(value, "$", new Set<object>());
}

function utf8Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) {
      length += 1;
    } else if (codeUnit < 0x800) {
      length += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      length += 4;
      index += 1;
    } else {
      length += 3;
    }
  }
  return length;
}

function encodeUtf8(value: string): Uint8Array {
  const bytes = new Uint8Array(utf8Length(value));
  let offset = 0;

  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint < 0x80) {
      bytes[offset++] = codePoint;
    } else if (codePoint < 0x800) {
      bytes[offset++] = 0xc0 | (codePoint >>> 6);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
      bytes[offset++] = 0xf0 | (codePoint >>> 18);
      bytes[offset++] = 0x80 | ((codePoint >>> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
      index += 1;
    } else {
      bytes[offset++] = 0xe0 | (codePoint >>> 12);
      bytes[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    }
  }

  return bytes;
}

/** UTF-8 bytes of canonicalStringify(value). */
export function canonicalBytes(value: unknown): Uint8Array {
  return encodeUtf8(canonicalStringify(value));
}

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Synchronous pure-TypeScript SHA-256 (FIPS 180-4). */
export function sha256(bytes: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;

  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const bitLengthLow = (bytes.length << 3) >>> 0;
  const lengthOffset = paddedLength - 8;
  message[lengthOffset] = bitLengthHigh >>> 24;
  message[lengthOffset + 1] = bitLengthHigh >>> 16;
  message[lengthOffset + 2] = bitLengthHigh >>> 8;
  message[lengthOffset + 3] = bitLengthHigh;
  message[lengthOffset + 4] = bitLengthLow >>> 24;
  message[lengthOffset + 5] = bitLengthLow >>> 16;
  message[lengthOffset + 6] = bitLengthLow >>> 8;
  message[lengthOffset + 7] = bitLengthLow;

  const state = new Uint32Array(SHA256_INITIAL);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        ((message[wordOffset] ?? 0) << 24) |
        ((message[wordOffset + 1] ?? 0) << 16) |
        ((message[wordOffset + 2] ?? 0) << 8) |
        (message[wordOffset + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < state.length; index += 1) {
    const word = state[index] ?? 0;
    const offset = index * 4;
    digest[offset] = word >>> 24;
    digest[offset + 1] = word >>> 16;
    digest[offset + 2] = word >>> 8;
    digest[offset + 3] = word;
  }
  return digest;
}

function hex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += HEX.charAt(byte >>> 4) + HEX.charAt(byte & 0x0f);
  }
  return result;
}

/** Return the SHA-256 hash of a value's canonical UTF-8 representation. */
export function hashValue(value: unknown): string {
  return `sha256:${hex(sha256(canonicalBytes(value)))}`;
}
