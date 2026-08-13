import { describe, expect, it } from "bun:test";

import { normalizeJoinCode } from "./joinCode";

describe("normalizeJoinCode", () => {
  it("trims surrounding whitespace and uppercases the code", () => {
    expect(normalizeJoinCode("  ab-cde\n")).toBe("AB-CDE");
  });

  it("leaves an already-normalized code unchanged", () => {
    expect(normalizeJoinCode("AB-CDE")).toBe("AB-CDE");
  });
});
