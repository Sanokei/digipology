import manifestJson from "./luaApiManifest.json" with { type: "json" };

export type LuaApiManifestEntryKind = "namespace" | "method" | "field" | "callback" | "guard";

export interface LuaApiManifestEntry {
  readonly label: string;
  readonly signature: string;
  readonly documentation: string;
  readonly kind: LuaApiManifestEntryKind;
  readonly owner: string;
}

export interface LuaApiManifest {
  readonly version: 1;
  readonly generatedFrom: "docs/lua-api.md";
  readonly namespaces: readonly string[];
  readonly proxies: readonly string[];
  readonly entries: readonly LuaApiManifestEntry[];
}

export const luaApiManifest = manifestJson as LuaApiManifest;
export default luaApiManifest;
