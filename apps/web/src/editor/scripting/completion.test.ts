import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LuaApiManifest } from "digipology-lua/lua-api-manifest";

import { manifestCompletionOptions } from "./completion";

describe("manifest-driven Lua completion", () => {
  test("only exposes entries supplied by a synthetic manifest", () => {
    const manifest: LuaApiManifest = {
      version: 1,
      generatedFrom: "docs/lua-api.md",
      namespaces: ["alpha"],
      proxies: [],
      entries: [
        { label: "alpha", signature: "alpha", documentation: "A", kind: "namespace", owner: "alpha" },
        { label: "alpha:beta()", signature: "alpha:beta()", documentation: "B", kind: "method", owner: "alpha" },
      ],
    };
    expect(manifestCompletionOptions(manifest).map((item) => item.label)).toEqual(["alpha", "alpha:beta()", "timer_callback"]);
    expect(manifestCompletionOptions(manifest, "alpha:").map((item) => item.label)).toEqual(["alpha:beta()", "timer_callback"]);
  });

  test("the extension source contains no copied real API entries", () => {
    const source = readFileSync(new URL("./completion.ts", import.meta.url), "utf8");
    for (const copiedName of ["scene:get", "random:choice", "players:list", "Deck:shuffle"]) {
      expect(source).not.toContain(copiedName);
    }
  });
});
