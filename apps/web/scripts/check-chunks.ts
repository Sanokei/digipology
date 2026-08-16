import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const assets = readdirSync(assetsDirectory).filter((name) => name.endsWith(".js"));

function oneChunk(prefix: string): string {
  const matches = assets.filter((name) => name.startsWith(`${prefix}-`));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${prefix} chunk, found ${matches.length}: ${matches.join(", ")}`);
  }
  const match = matches[0];
  if (match === undefined) throw new Error(`Missing ${prefix} chunk`);
  return match;
}

function contents(name: string): Buffer {
  return readFileSync(new URL(name, assetsDirectory));
}

function assertAbsent(name: string, source: string, forbidden: readonly string[]): void {
  const found = forbidden.filter((symbol) => source.includes(symbol));
  if (found.length > 0) throw new Error(`${name} contains symbols from the other engine: ${found.join(", ")}`);
}

const webglName = oneChunk("babylon-vendor");
const liteName = oneChunk("babylon-lite-vendor");
const webglAdapterName = oneChunk("webglSceneAdapter");
const liteAdapterName = oneChunk("liteSceneAdapter");
const webgl = contents(webglName);
const lite = contents(liteName);
const webglAdapter = contents(webglAdapterName).toString("utf8");
const liteAdapter = contents(liteAdapterName).toString("utf8");

assertAbsent(webglName, webgl.toString("utf8"), ["createSceneContext", "createGpuPicker", "ObservableVec3"]);
assertAbsent(liteName, lite.toString("utf8"), ["WebGLPipelineContext", "ThinEngine", "WebGL2RenderingContext"]);
assertAbsent(webglName, webgl.toString("utf8"), [liteName]);
assertAbsent(webglAdapterName, webglAdapter, [liteName]);
assertAbsent(liteName, lite.toString("utf8"), [webglName]);
assertAbsent(liteAdapterName, liteAdapter, [webglName]);

for (const [name, value] of [[webglName, webgl], [liteName, lite]] as const) {
  console.log(`${name}: ${value.byteLength} raw bytes, ${gzipSync(value).byteLength} gzip bytes`);
}
console.log("Babylon vendor chunks are isolated.");
