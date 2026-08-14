import { describe, expect, it } from "bun:test";

import { normalizeJoinCode } from "./joinCode";

describe("normalizeJoinCode", () => {
  const cases = [
    ["  abcd-efgh\n", "ABCD-EFGH"],
    ["abcd efgh", "ABCD-EFGH"],
    ["a-b-c-d-e-f-g-h", "ABCD-EFGH"],
    ["ABCDEFGH", "ABCD-EFGH"],
    ["https://play.digipology.com/join/abcd-efgh", "ABCD-EFGH"],
    ["https://play.digipology.com/join/ABCD%20EFGH?from=email", "ABCD-EFGH"],
  ] as const;
  for (const [input, output] of cases) {
    it(`normalizes ${input}`, () => expect(normalizeJoinCode(input)).toBe(output));
  }
});
