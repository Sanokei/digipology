/** The frozen algorithm identifier serialized into canonical game state. */
export const SFC32_V1 = "sfc32-v1" as const;

/** Number of internal core steps discarded after expanding a seed. */
export const SFC32_V1_WARMUP_DRAWS = 12;

const UINT32_SIZE = 0x1_0000_0000;
const UINT32_MAX = UINT32_SIZE - 1;
const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;
const SPLITMIX_INCREMENT = 0x9e3779b9;
const SPLITMIX_MULTIPLIER_1 = 0x21f0aaad;
const SPLITMIX_MULTIPLIER_2 = 0x735a2d97;

export interface RngState {
  algorithm: typeof SFC32_V1;
  state: [number, number, number, number];
  draws: number;
}

export interface Rng {
  /** Return a detached, canonical-JSON-compatible snapshot. */
  state(): RngState;
  /** Return the next unsigned 32-bit integer. */
  next(): number;
  /** Return a multiple of 2^-32 in the half-open interval [0, 1). */
  float(): number;
  /** Return an unbiased integer in the inclusive interval [min, max]. */
  int(min: number, max: number): number;
  /** Return an element selected uniformly from a non-empty array. */
  choice<T>(arr: readonly T[]): T;
  /** Return a newly allocated Fisher-Yates permutation. */
  shuffle<T>(arr: readonly T[]): T[];
}

export type InvalidRngStateReason =
  | "not-an-object"
  | "unknown-algorithm"
  | "malformed-state"
  | "invalid-draw-count";

/** Thrown when a serialized RNG snapshot is not a valid sfc32-v1 state. */
export class InvalidRngStateError extends Error {
  readonly reason: InvalidRngStateReason;

  constructor(reason: InvalidRngStateReason, detail: string) {
    super(`Invalid RNG state: ${detail}`);
    this.name = "InvalidRngStateError";
    this.reason = reason;
  }
}

function isUint32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= UINT32_MAX
  );
}

function fnv1aByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV1A_PRIME) >>> 0;
}

/**
 * FNV-1a over the UTF-8 encoding of a JavaScript string. Unpaired UTF-16
 * surrogates are encoded as U+FFFD, matching the standard UTF-8 scalar-value
 * conversion and keeping all possible JavaScript strings deterministic.
 */
function fnv1aUtf8(value: string): number {
  let hash = FNV1A_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let codePoint = first;

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint =
          0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint < 0x80) {
      hash = fnv1aByte(hash, codePoint);
    } else if (codePoint < 0x800) {
      hash = fnv1aByte(hash, 0xc0 | (codePoint >>> 6));
      hash = fnv1aByte(hash, 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      hash = fnv1aByte(hash, 0xe0 | (codePoint >>> 12));
      hash = fnv1aByte(hash, 0x80 | ((codePoint >>> 6) & 0x3f));
      hash = fnv1aByte(hash, 0x80 | (codePoint & 0x3f));
    } else {
      hash = fnv1aByte(hash, 0xf0 | (codePoint >>> 18));
      hash = fnv1aByte(hash, 0x80 | ((codePoint >>> 12) & 0x3f));
      hash = fnv1aByte(hash, 0x80 | ((codePoint >>> 6) & 0x3f));
      hash = fnv1aByte(hash, 0x80 | (codePoint & 0x3f));
    }
  }

  return hash;
}

function splitmix32(state: number): [number, number] {
  const nextState = (state + SPLITMIX_INCREMENT) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 16), SPLITMIX_MULTIPLIER_1) >>> 0;
  value = Math.imul(value ^ (value >>> 15), SPLITMIX_MULTIPLIER_2) >>> 0;
  return [nextState, (value ^ (value >>> 15)) >>> 0];
}

class Sfc32V1 implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private drawCount: number;

  constructor(words: readonly [number, number, number, number], draws: number) {
    this.a = words[0];
    this.b = words[1];
    this.c = words[2];
    this.d = words[3];
    this.drawCount = draws;
  }

  state(): RngState {
    return {
      algorithm: SFC32_V1,
      state: [this.a, this.b, this.c, this.d],
      draws: this.drawCount,
    };
  }

  private step(): number {
    let result = (this.a + this.b) | 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.d = (this.d + 1) >>> 0;
    result = (result + this.d) | 0;
    this.c = (this.c + result) >>> 0;
    return result >>> 0;
  }

  next(): number {
    if (this.drawCount === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("RNG draw count exceeds Number.MAX_SAFE_INTEGER");
    }
    const result = this.step();
    this.drawCount += 1;
    return result;
  }

  float(): number {
    return this.next() / UINT32_SIZE;
  }

  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new TypeError("RNG integer bounds must be safe integers");
    }
    if (min > max) {
      throw new RangeError("RNG integer minimum must not exceed maximum");
    }

    const size = max - min + 1;
    if (size > UINT32_SIZE) {
      throw new RangeError("RNG integer interval cannot exceed 2^32 values");
    }

    const limit = Math.floor(UINT32_SIZE / size) * size;
    let value: number;
    do {
      value = this.next();
    } while (value >= limit);
    return min + (value % size);
  }

  choice<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new RangeError("Cannot choose from an empty array");
    }
    return arr[this.int(0, arr.length - 1)] as T;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const result = Array.from(arr);
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index);
      const temporary = result[index] as T;
      result[index] = result[swapIndex] as T;
      result[swapIndex] = temporary;
    }
    return result;
  }

  warmUp(draws: number): void {
    for (let index = 0; index < draws; index += 1) {
      this.step();
    }
  }
}

function seedWords(seed: string | number): [number, number, number, number] {
  let splitmixState: number;
  if (typeof seed === "string") {
    splitmixState = fnv1aUtf8(seed);
  } else if (typeof seed === "number" && Number.isSafeInteger(seed)) {
    splitmixState = seed >>> 0;
  } else {
    throw new TypeError("RNG seed must be a string or a safe integer");
  }

  const words: [number, number, number, number] = [0, 0, 0, 0];
  for (let index = 0; index < words.length; index += 1) {
    const result = splitmix32(splitmixState);
    splitmixState = result[0];
    words[index] = result[1];
  }
  return words;
}

/** Create a new sfc32-v1 stream from a string or numeric seed. */
export function createRng(seed: string | number): Rng {
  const rng = new Sfc32V1(seedWords(seed), 0);
  rng.warmUp(SFC32_V1_WARMUP_DRAWS);
  return rng;
}

/** Validate and resume a previously serialized sfc32-v1 snapshot. */
export function fromState(s: RngState): Rng {
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    throw new InvalidRngStateError("not-an-object", "expected an object");
  }

  const candidate = s as unknown as {
    algorithm?: unknown;
    state?: unknown;
    draws?: unknown;
  };
  if (candidate.algorithm !== SFC32_V1) {
    throw new InvalidRngStateError(
      "unknown-algorithm",
      `unsupported algorithm ${String(candidate.algorithm)}`,
    );
  }
  if (
    !Array.isArray(candidate.state) ||
    candidate.state.length !== 4 ||
    !isUint32(candidate.state[0]) ||
    !isUint32(candidate.state[1]) ||
    !isUint32(candidate.state[2]) ||
    !isUint32(candidate.state[3])
  ) {
    throw new InvalidRngStateError(
      "malformed-state",
      "state must be an array of exactly four uint32 values",
    );
  }
  if (
    typeof candidate.draws !== "number" ||
    !Number.isSafeInteger(candidate.draws) ||
    candidate.draws < 0
  ) {
    throw new InvalidRngStateError(
      "invalid-draw-count",
      "draws must be a non-negative safe integer",
    );
  }

  return new Sfc32V1(
    [
      candidate.state[0] as number,
      candidate.state[1] as number,
      candidate.state[2] as number,
      candidate.state[3] as number,
    ],
    candidate.draws,
  );
}
