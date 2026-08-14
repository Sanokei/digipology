import { describe, expect, it } from "bun:test";

import { formatCompactCount } from "./compactCount";

describe("formatCompactCount", () => {
  it("pins compact boundaries and rounding", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
    expect(formatCompactCount(1_000)).toBe("1.0k");
    expect(formatCompactCount(1_249)).toBe("1.2k");
    expect(formatCompactCount(999_949)).toBe("999.9k");
    expect(formatCompactCount(1_000_000)).toBe("1.0M");
  });

  it("degrades invalid and negative values to zero", () => {
    expect(formatCompactCount(Number.NaN)).toBe("0");
    expect(formatCompactCount(-1)).toBe("0");
  });
});
