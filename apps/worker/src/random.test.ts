import { describe, expect, test } from "bun:test";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, generateJoinCode, generateSessionToken, isValidJoinCode, normalizeJoinCode } from "./random";

const deterministicCrypto = {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array instanceof Uint8Array) array.forEach((_, index) => { array[index] = index * 37; });
    return array;
  },
} as Crypto;

describe("random identifiers", () => {
  test("join codes use eight characters from a 32-symbol alphabet (40 bits)", () => {
    // Eight independent symbols at log2(32) = 5 bits each yields 40 bits.
    expect(Math.log2(JOIN_CODE_ALPHABET.length ** JOIN_CODE_LENGTH)).toBe(40);
    for (let index = 0; index < 128; index += 1) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      expect(isValidJoinCode(code)).toBe(true);
    }
  });

  test("normalizes casing, ASCII whitespace, and an optional hyphen", () => {
    const cases = ["ABCD-2345", "abcd-2345", " abcd - 2345 ", "ABCD2345", "AB CD\t23 45"];
    for (const value of cases) {
      expect(normalizeJoinCode(value)).toBe("ABCD2345");
      expect(isValidJoinCode(value)).toBe(true);
    }
  });

  test("rejects ambiguous and Unicode lookalike characters", () => {
    for (const value of ["ABCI-2345", "ABCO-2345", "ABCDâ€2345", "ABCÎ”-2345", "ABCD-23ï¼”5"]) {
      expect(isValidJoinCode(value)).toBe(false);
    }
  });

  test("session tokens contain 256 random bits", () => {
    expect(generateSessionToken(deterministicCrypto)).toMatch(/^[0-9a-f]{64}$/);
  });
});
