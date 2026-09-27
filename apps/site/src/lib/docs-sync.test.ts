import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  isPublishableRepositoryDoc,
  parseRepositoryDoc,
  syncRepositoryDocs,
  transformRepositoryDoc,
} from "./docs-sync";

describe("repository documentation sync", () => {
  test.each([
    ["./sibling.md", "/docs/guide/sibling/"],
    ["../other//page.md", "/docs/other/page/"],
    ["sibling.md", "/docs/guide/sibling/"],
    ["sibling.md#details", "/docs/guide/sibling/#details"],
    ["../releasing.md#release", "https://github.com/Sanokei/digipology/blob/main/docs/releasing.md#release"],
    ["unpublished.md", "https://github.com/Sanokei/digipology/blob/main/docs/guide/unpublished.md"],
    ["https://example.com/sibling.md#details", "https://example.com/sibling.md#details"],
    ["//example.com/sibling.md", "//example.com/sibling.md"],
    ["mailto:editor@example.com", "mailto:editor@example.com"],
    ["/docs/sibling.md", "/docs/sibling.md"],
    ["#details", "#details"],
    ["?view=sibling.md", "?view=sibling.md"],
    ["image.png", "image.png"],
  ])("resolves %s to %s", (target, expected) => {
    const source = `---\ntitle: Guide\ndescription: Link fixture.\n---\n[link](${target})\n[title](<${target}> "Link title")\n`;
    const transformed = transformRepositoryDoc(
      source,
      "guide/index.md",
      new Set(["guide/index.md", "guide/sibling.md", "other/page.md"]),
    );

    expect(transformed.body).toBe(
      `[link](${expected})\n[title](<${expected}> "Link title")\n`,
    );
  });

  test("injects validated metadata, removes the duplicate H1, and rewrites links", () => {
    const source = `---
title: Lua API
description: Creator reference.
---

# Lua API

Read [actions](./actions.md#deck-shuffle) and [the spec](./spec/handoff-v2.txt).
`;
    const transformed = transformRepositoryDoc(
      source,
      "lua-api.md",
      new Set(["actions.md", "lua-api.md"]),
    );

    expect(transformed.output).toStartWith(
      `---\ntitle: "Lua API"\ndescription: "Creator reference."\n---`,
    );
    expect(transformed.body).not.toContain("# Lua API");
    expect(transformed.body).toContain("](/docs/actions/#deck-shuffle)");
    expect(transformed.body).toContain(
      "](https://github.com/Sanokei/digipology/blob/main/docs/spec/handoff-v2.txt)",
    );
  });

  test("rejects an invalid-frontmatter fixture with a clear error", () => {
    const fixture = readFileSync(
      resolve(import.meta.dir, "fixtures/invalid-frontmatter.md"),
      "utf8",
    );

    expect(() => parseRepositoryDoc(fixture, "invalid-frontmatter.md")).toThrow(
      "title and description must be non-empty strings",
    );
  });

  test("rejects missing frontmatter", () => {
    expect(() => parseRepositoryDoc("# No metadata", "missing.md")).toThrow(
      "Missing docs frontmatter in missing.md",
    );
  });

  test("publishes new root docs while explicitly excluding internal material", () => {
    expect(isPublishableRepositoryDoc("bundle-format.md")).toBe(true);
    expect(isPublishableRepositoryDoc("adr/0002-platform.md")).toBe(false);
    expect(isPublishableRepositoryDoc("runbooks/deploy.md")).toBe(false);
    expect(isPublishableRepositoryDoc("spec/handoff-v2.md")).toBe(false);
    expect(isPublishableRepositoryDoc("releasing.md")).toBe(false);
    expect(isPublishableRepositoryDoc("evidence/site/issue27/README.md")).toBe(false);
  });

  test("discovers a new source file without wiring and omits excluded trees", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "digipology-docs-sync-"));
    const repositoryDocs = join(temporaryRoot, "docs");
    const siteRoot = join(temporaryRoot, "apps", "site");

    try {
      mkdirSync(join(repositoryDocs, "spec"), { recursive: true });
      mkdirSync(join(repositoryDocs, "evidence", "site", "issue27"), { recursive: true });
      writeFileSync(
        join(repositoryDocs, "evidence", "site", "issue27", "README.md"),
        "# Internal capture evidence without publishable frontmatter\n",
      );
      writeFileSync(
        join(repositoryDocs, "bundle-format.md"),
        "---\ntitle: Bundle format\ndescription: Release bundles.\n---\n\n# Bundle format\n",
      );
      writeFileSync(
        join(repositoryDocs, "spec", "internal.md"),
        "---\ntitle: Internal\ndescription: Do not publish.\n---\n\n# Internal\n",
      );

      expect(syncRepositoryDocs({ repositoryDocs, siteRoot })).toEqual([
        "bundle-format.md",
      ]);
      expect(
        existsSync(
          join(siteRoot, "src", "content", "docs", "repository", "bundle-format.md"),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(siteRoot, "src", "content", "docs", "repository", "spec", "internal.md"),
        ),
      ).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
