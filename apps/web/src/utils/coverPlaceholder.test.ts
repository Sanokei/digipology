import { describe, expect, it } from "bun:test";

import { coverPlaceholder } from "./coverPlaceholder";

describe("coverPlaceholder", () => {
  it("is deterministic for the same slug", () => {
    expect(coverPlaceholder("hex-table")).toEqual(coverPlaceholder("hex-table"));
  });

  it("diverges for distinct slugs", () => {
    expect(coverPlaceholder("hex-table")).not.toEqual(coverPlaceholder("word-party"));
  });
});
