import { describe, expect, test } from "bun:test";

import { docPath, getDocNavigation, orderDocs } from "./docs";

const docs = [
  {
    id: "repository/bundle-format",
    data: { title: "Bundle format", description: "Future reference" },
  },
  {
    id: "repository/actions",
    data: { title: "Canonical actions", description: "Actions" },
  },
  {
    id: "repository/lua-api",
    data: { title: "Lua API v1", description: "Reference" },
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
      "repository/lua-api",
      "repository/actions",
      "repository/bundle-format",
    ]);
  });

  test("provides neighboring pages without mutating its input", () => {
    const originalOrder = docs.map((doc) => doc.id);
    const navigation = getDocNavigation(docs, "architecture");

    expect(navigation.previous?.id).toBe("getting-started");
    expect(navigation.next?.id).toBe("repository/lua-api");
    expect(docs.map((doc) => doc.id)).toEqual(originalOrder);
  });

  test("rejects a missing active page", () => {
    expect(() => getDocNavigation(docs, "missing")).toThrow(
      "Unknown documentation entry: missing",
    );
  });

  test("creates canonical trailing-slash paths", () => {
    expect(docPath("architecture")).toBe("/docs/architecture/");
    expect(docPath("repository/lua-api")).toBe("/docs/lua-api/");
  });

  test("contains no retired Lua preview entry", () => {
    expect(orderDocs(docs).some((doc) => doc.id.includes("lua-preview"))).toBe(false);
  });
});
