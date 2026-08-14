import { describe, expect, it } from "bun:test";
import { joinErrorKind, joinErrorView } from "./joinModel";

describe("join recovery states", () => {
  for (const code of ["not_found", "full", "ended"] as const) {
    it(`keeps ${code} distinct`, () => {
      expect(joinErrorKind(code)).toBe(code);
      expect(joinErrorView(code).title).not.toBe(joinErrorView("failed").title);
    });
  }
  it("maps unknown failures to retry", () => expect(joinErrorView(joinErrorKind("network_error")).action).toBe("retry"));
});
