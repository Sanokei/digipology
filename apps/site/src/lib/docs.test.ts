import { describe, expect, test } from "bun:test";

import { docPath, getDocNavigation, orderDocs } from "./docs";

const docs = [
  {
    id: "future-reference",
    data: { title: "API reference", description: "Future reference" },
  },
  {
    id: "lua-preview",
    data: { title: "Lua API preview", description: "Preview" },
  },
  {
    id: "getting-started",
    data: { title: "Getting started", description: "Start here" },
  },
  {
    id: "architecture",
    data: { title: "Architecture", description: "How it works" },
  },
] as const;

describe("documentation navigation", () => {
  test("keeps featured pages in narrative order and appends future docs", () => {
    expect(orderDocs(docs).map((doc) => doc.id)).toEqual([
      "getting-started",
      "architecture",
      "lua-preview",
      "future-reference",
    ]);
  });

  test("provides neighboring pages without mutating its input", () => {
    const originalOrder = docs.map((doc) => doc.id);
    const navigation = getDocNavigation(docs, "architecture");

    expect(navigation.previous?.id).toBe("getting-started");
    expect(navigation.next?.id).toBe("lua-preview");
    expect(docs.map((doc) => doc.id)).toEqual(originalOrder);
  });

  test("rejects a missing active page", () => {
    expect(() => getDocNavigation(docs, "missing")).toThrow(
      "Unknown documentation entry: missing",
    );
  });

  test("creates canonical trailing-slash paths", () => {
    expect(docPath("architecture")).toBe("/docs/architecture/");
  });
});
