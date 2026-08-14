import { describe, expect, test } from "bun:test";

import coreFixtures from "../fixtures/core.json";
import numberFixtures from "../fixtures/numbers.json";
import unicodeFixtures from "../fixtures/unicode.json";
import {
  canonicalBytes,
  canonicalStringify,
  CanonicalizationError,
  hashValue,
  sha256,
} from "./index";

interface GoldenFixture {
  readonly name: string;
  readonly value: unknown;
  readonly canonical: string;
  readonly hash: string;
}

const goldenFixtures = [
  ...coreFixtures,
  ...numberFixtures,
  ...unicodeFixtures,
] as readonly GoldenFixture[];

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit > 0x7f) throw new Error("Test helper only accepts ASCII");
    bytes[index] = codeUnit;
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  const alphabet = "0123456789abcdef";
  let result = "";
  for (const byte of bytes) {
    result += alphabet.charAt(byte >>> 4) + alphabet.charAt(byte & 0x0f);
  }
  return result;
}

function expectCanonicalizationError(
  operation: () => unknown,
  reason: CanonicalizationError["reason"],
  path: string,
): void {
  try {
    operation();
    throw new Error("Expected CanonicalizationError");
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalizationError);
    expect((error as CanonicalizationError).reason).toBe(reason);
    expect((error as CanonicalizationError).path).toBe(path);
  }
}

describe("golden determinism fixtures", () => {
  for (const fixture of goldenFixtures) {
    test(fixture.name, () => {
      expect(canonicalStringify(fixture.value)).toBe(fixture.canonical);
      expect(hashValue(fixture.value)).toBe(fixture.hash);
      expect(canonicalBytes(fixture.value)).toEqual(asciiOrUtf8Fixture(fixture.canonical));
    });
  }
});

function asciiOrUtf8Fixture(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
      index += 1;
    } else {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

describe("canonicalStringify", () => {
  test("sorts object keys independently of insertion order", () => {
    const forward = { a: 1, b: 2 };
    const reverse: Record<string, number> = {};
    reverse.b = 2;
    reverse.a = 1;

    expect(canonicalStringify(forward)).toBe('{"a":1,"b":2}');
    expect(canonicalStringify(reverse)).toBe(canonicalStringify(forward));
    expect(canonicalBytes(reverse)).toEqual(canonicalBytes(forward));
  });

  test("orders keys by UTF-16 code units", () => {
    expect(canonicalStringify({ "\ue000": 2, "😀": 1 })).toBe(
      '{"😀":1,"":2}',
    );
  });

  test("uses the fixed string escaping policy", () => {
    expect(canonicalStringify('"\\\b\f\n\r\t\u001f/')).toBe(
      '"\\"\\\\\\u0008\\u000c\\u000a\\u000d\\u0009\\u001f/"',
    );
    expect(canonicalStringify("\ud800")).toBe('"\\ud800"');
    expect(canonicalStringify("\udc00")).toBe('"\\udc00"');
  });

  test("formats the required number cases with Number::toString", () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [0, "0"],
      [-0, "0"],
      [1, "1"],
      [-1, "-1"],
      [0.1, "0.1"],
      [1.5, "1.5"],
      [1e21, "1e+21"],
      [1e-7, "1e-7"],
      [9007199254740991, "9007199254740991"],
      [2 ** 53, "9007199254740992"],
      [5e-324, "5e-324"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
    ];

    for (const [value, expected] of cases) {
      expect(canonicalStringify(value)).toBe(expected);
    }
  });

  test("allows repeated acyclic references", () => {
    const shared = { value: 1 };
    expect(canonicalStringify([shared, shared])).toBe(
      '[{"value":1},{"value":1}]',
    );
  });
});

describe("canonicalBytes", () => {
  test("encodes astral-plane strings as UTF-8 without a platform encoder", () => {
    expect(canonicalBytes("😀")).toEqual(
      new Uint8Array([0x22, 0xf0, 0x9f, 0x98, 0x80, 0x22]),
    );
  });
});

describe("rejections and paths", () => {
  test("reports non-finite numbers", () => {
    expectCanonicalizationError(
      () => canonicalStringify({ values: [Number.NaN] }),
      "nan",
      "$.values[0]",
    );
    expectCanonicalizationError(
      () => canonicalStringify({ values: [Number.POSITIVE_INFINITY] }),
      "infinity",
      "$.values[0]",
    );
    expectCanonicalizationError(
      () => canonicalStringify({ values: [Number.NEGATIVE_INFINITY] }),
      "infinity",
      "$.values[0]",
    );
  });

  test("reports undefined and functions", () => {
    expectCanonicalizationError(
      () => canonicalStringify({ "missing.value": undefined }),
      "undefined",
      '$["missing.value"]',
    );
    expectCanonicalizationError(
      () => canonicalStringify([() => 1]),
      "function",
      "$[0]",
    );
  });

  test("reports cycles at the edge that closes the cycle", () => {
    const cyclic: { child?: { parent?: unknown } } = {};
    cyclic.child = { parent: cyclic };
    expectCanonicalizationError(
      () => canonicalStringify(cyclic),
      "cycle",
      "$.child.parent",
    );
  });

  test("reports symbol keys as non-string keys", () => {
    const value: Record<PropertyKey, unknown> = { valid: true };
    value[Symbol("hidden")] = 1;
    expectCanonicalizationError(
      () => canonicalStringify(value),
      "non-string-key",
      "$",
    );
  });

  test("reports every unsupported value category", () => {
    class Example {}

    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [Symbol("value"), "$.bad"],
      [1n, "$.bad"],
      [new Map([["key", "value"]]), "$.bad"],
      [new Set(["value"]), "$.bad"],
      [new Example(), "$.bad"],
    ];

    for (const [value, path] of cases) {
      expectCanonicalizationError(
        () => canonicalStringify({ bad: value }),
        "unsupported-type",
        path,
      );
    }
  });

  test("rejects non-data shapes instead of silently discarding or invoking", () => {
    const sparse = new Array(1);
    expectCanonicalizationError(
      () => canonicalStringify(sparse),
      "undefined",
      "$[0]",
    );

    const customArray = [1] as unknown[] & { extra?: number };
    customArray.extra = 2;
    expectCanonicalizationError(
      () => canonicalStringify(customArray),
      "unsupported-type",
      "$.extra",
    );

    const accessor = Object.defineProperty({}, "danger", {
      enumerable: true,
      get(): never {
        throw new Error("must not execute");
      },
    });
    expectCanonicalizationError(
      () => canonicalStringify(accessor),
      "unsupported-type",
      "$.danger",
    );

    const hidden = Object.defineProperty({}, "hidden", {
      enumerable: false,
      value: 1,
    });
    expectCanonicalizationError(
      () => canonicalStringify(hidden),
      "unsupported-type",
      "$.hidden",
    );
  });
});

describe("sha256", () => {
  const vectors: ReadonlyArray<readonly [string, string]> = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmn" +
        "hijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
  ];

  for (const [input, expected] of vectors) {
    test(`matches the FIPS vector for ${input.length} bytes`, () => {
      expect(toHex(sha256(ascii(input)))).toBe(expected);
    });
  }

  test("matches an independently calculated vector larger than one MiB", () => {
    const input = new Uint8Array(1_048_577);
    input.fill(0x61);
    expect(toHex(sha256(input))).toBe(
      "4a3f0c0c213adea174f9a3d4c13177315b588bdb2e9c1012d3d0bf0453ca0f6a",
    );
  });
});

describe("hashValue", () => {
  test("returns a prefixed lowercase SHA-256 digest", () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
    expect(hashValue({ a: 1, b: 2 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("normalizes negative zero before hashing", () => {
    expect(hashValue(-0)).toBe(hashValue(0));
  });
});

class DeterministicGenerator {
  private state = 0x6d2b79f5;

  next(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state;
  }

  below(limit: number): number {
    return this.next() % limit;
  }
}

const generatedStrings = [
  "",
  "plain",
  'quote"slash\\',
  "\u0000\n\t",
  "β",
  "😀",
  "\ud800",
] as const;

const generatedNumbers = [
  0,
  -0,
  1,
  -1,
  0.1,
  1e21,
  1e-7,
  5e-324,
  9007199254740991,
] as const;

function generatedValue(generator: DeterministicGenerator, depth: number): unknown {
  const leafKinds = 4;
  const kind = generator.below(depth === 0 ? leafKinds : 6);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return generator.below(2) === 0;
    case 2:
      return generatedNumbers[generator.below(generatedNumbers.length)];
    case 3:
      return generatedStrings[generator.below(generatedStrings.length)];
    case 4: {
      const length = generator.below(5);
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        result.push(generatedValue(generator, depth - 1));
      }
      return result;
    }
    default: {
      const keys = ["z", "a", "nested.key", "β", "k2", "k10"] as const;
      const count = generator.below(keys.length + 1);
      const result: Record<string, unknown> = {};
      for (let index = 0; index < count; index += 1) {
        const key = keys[generator.below(keys.length)] ?? "fallback";
        result[key] = generatedValue(generator, depth - 1);
      }
      return result;
    }
  }
}

function normalizeNegativeZero(value: unknown): unknown {
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  if (Array.isArray(value)) return value.map(normalizeNegativeZero);
  if (value !== null && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeNegativeZero(
        (value as Record<string, unknown>)[key],
      );
    }
    return normalized;
  }
  return value;
}

describe("generated canonical-compatible values", () => {
  test("round-trip to normalized values and reach a fixed point", () => {
    const generator = new DeterministicGenerator();
    for (let iteration = 0; iteration < 1_000; iteration += 1) {
      const value = generatedValue(generator, 4);
      const canonical = canonicalStringify(value);
      const parsed: unknown = JSON.parse(canonical);
      expect(parsed).toEqual(normalizeNegativeZero(value));
      expect(canonicalStringify(parsed)).toBe(canonical);
    }
  });
});
