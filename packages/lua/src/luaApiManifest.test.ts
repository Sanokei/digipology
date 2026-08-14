import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { luaApiManifest } from "./luaApiManifest";

describe("generated Lua API manifest", () => {
  test("tracks sampled docs headings and every required surface", () => {
    const docs = readFileSync(resolve(import.meta.dir, "../../../docs/lua-api.md"), "utf8");
    for (const heading of ["scene:get(id)", "random:choice(list)", "timer:after(delay, callback_name)"]) {
      expect(docs).toContain(`#### \`${heading}\``);
      expect(luaApiManifest.entries.some((entry) => entry.signature === heading)).toBe(true);
    }
    expect(luaApiManifest.namespaces).toEqual([
      "state", "refs", "settings", "game", "scene", "players", "random", "timer", "ui", "data",
    ]);
    expect(luaApiManifest.proxies).toContain("SnapPoint");
    expect(luaApiManifest.entries.some((entry) => entry.label === "on_player_disconnect")).toBe(true);
    expect(luaApiManifest.entries.some((entry) => entry.label === "can_press")).toBe(true);
  });
});
