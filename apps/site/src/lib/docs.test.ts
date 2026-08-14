import { describe, expect, test } from "bun:test";

import { docPath, getDocNavigation, orderDocs } from "./docs";

const docs = [
  {
    id: "repository/ai-features",
    data: { title: "AI features", description: "AI" },
  },
  {
    id: "repository/bundle-format",
    data: { title: "Bundle format", description: "Bundle reference" },
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
  {
    id: "repository/creator-guide",
    data: { title: "Creator guide", description: "Create" },
  },
  {
    id: "repository/playing",
    data: { title: "Playing", description: "Play" },
  },
  {
    id: "repository/z-future",
    data: { title: "Z future", description: "Unknown" },
  },
  {
    id: "repository/a-future",
    data: { title: "A future", description: "Unknown" },
  },
] as const;

describe("documentation navigation", () => {
  test("keeps featured pages in narrative order and appends future docs", () => {
    expect(orderDocs(docs).map((doc) => doc.id)).toEqual([
      "getting-started",
      "repository/playing",
      "repository/creator-guide",
      "repository/ai-features",
      "architecture",
      "repository/lua-api",
      "repository/actions",
      "repository/bundle-format",
      "repository/a-future",
      "repository/z-future",
    ]);
  });

  test("provides neighboring pages without mutating its input", () => {
    const originalOrder = docs.map((doc) => doc.id);
    const navigation = getDocNavigation(docs, "repository/creator-guide");

    expect(navigation.previous?.id).toBe("repository/playing");
    expect(navigation.next?.id).toBe("repository/ai-features");
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
