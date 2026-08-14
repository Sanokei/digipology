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
  });

  test("discovers a new source file without wiring and omits excluded trees", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "digipology-docs-sync-"));
    const repositoryDocs = join(temporaryRoot, "docs");
    const siteRoot = join(temporaryRoot, "apps", "site");

    try {
      mkdirSync(join(repositoryDocs, "spec"), { recursive: true });
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
