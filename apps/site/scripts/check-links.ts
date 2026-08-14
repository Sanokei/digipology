import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const outputRoot = resolve(import.meta.dir, "../dist");
const siteOrigin = "https://digipology.com";

function collectHtmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectHtmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  });
}

function routeToFile(pathname: string): string {
  const decodedPath = decodeURIComponent(pathname);
  if (decodedPath === "/") return resolve(outputRoot, "index.html");
  if (decodedPath.endsWith("/")) {
    return resolve(outputRoot, `.${decodedPath}`, "index.html");
  }
  if (decodedPath.endsWith(".html")) return resolve(outputRoot, `.${decodedPath}`);
  return resolve(outputRoot, `.${decodedPath}`, "index.html");
}

function isInsideOutput(path: string): boolean {
  const pathFromRoot = relative(outputRoot, path);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`);
}

function hasFragment(file: string, fragment: string): boolean {
  const decodedFragment = decodeURIComponent(fragment);
  const html = readFileSync(file, "utf8");
  const escaped = decodedFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:id|name)=["']${escaped}["']`).test(html);
}

if (!existsSync(outputRoot)) {
  throw new Error(`Static output not found: ${outputRoot}`);
}

const luaPreviewRedirect = routeToFile("/docs/lua-preview/");
if (!existsSync(luaPreviewRedirect)) {
  throw new Error("Lua preview redirect artifact is missing.");
}
const luaPreviewHtml = readFileSync(luaPreviewRedirect, "utf8");
if (
  !luaPreviewHtml.includes('http-equiv="refresh"') ||
  !luaPreviewHtml.includes("url=/docs/lua-api/") ||
  !luaPreviewHtml.includes('href="https://digipology.com/docs/lua-api/"')
) {
  throw new Error("Lua preview redirect does not target the canonical Lua API page.");
}

const failures = new Set<string>();
const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;

for (const sourceFile of collectHtmlFiles(outputRoot)) {
  const sourceRoute = `/${relative(outputRoot, sourceFile).replaceAll("\\", "/")}`;
  const sourceUrl = new URL(sourceRoute, siteOrigin);
  const sourceHtml = readFileSync(sourceFile, "utf8");

  for (const match of sourceHtml.matchAll(anchorPattern)) {
    const href = match[2];
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

    const targetUrl = new URL(href, sourceUrl);
    if (targetUrl.origin !== siteOrigin) continue;

    const targetFile = routeToFile(targetUrl.pathname);
    if (!isInsideOutput(targetFile) || !existsSync(targetFile)) {
      failures.add(`${sourceRoute} -> ${href} (missing page)`);
      continue;
    }

    if (targetUrl.hash && !hasFragment(targetFile, targetUrl.hash.slice(1))) {
      failures.add(`${sourceRoute} -> ${href} (missing fragment)`);
    }
  }
}

if (failures.size > 0) {
  throw new Error(`Internal link check failed:\n${[...failures].sort().join("\n")}`);
}

console.log("Internal link check passed.");
