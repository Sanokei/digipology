import { describe, expect, test } from "bun:test";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, generateJoinCode, generateSessionToken, normalizeJoinCode } from "./random";

const deterministicCrypto = {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array instanceof Uint8Array) array.forEach((_, index) => { array[index] = index * 37; });
    return array;
  },
} as Crypto;

describe("random identifiers", () => {
  test("join codes use a seven-character 32-symbol alphabet (35 bits)", () => {
    expect(Math.log2(JOIN_CODE_ALPHABET.length ** JOIN_CODE_LENGTH)).toBe(35);
    const code = generateJoinCode(deterministicCrypto);
    expect(code).toHaveLength(7);
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/);
  });

  test("normalizes case and whitespace", () => {
    expect(normalizeJoinCode("  ab cd\t23  ")).toBe("ABCD23");
  });

  test("session tokens contain 192 random bits", () => {
    expect(generateSessionToken(deterministicCrypto)).toMatch(/^[0-9a-f]{48}$/);
  });
});
