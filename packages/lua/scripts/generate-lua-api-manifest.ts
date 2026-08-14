import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsPath = resolve(here, "../../../docs/lua-api.md");
const outputPath = resolve(here, "../src/luaApiManifest.json");
const source = readFileSync(docsPath, "utf8").replaceAll("\r\n", "\n");

const namespaceNames = [
  "state", "refs", "settings", "game", "scene", "players", "random", "timer", "ui", "data",
] as const;
const proxyNames = [
  "Card", "Deck", "Hand", "Container", "Die", "Counter", "Zone", "SnapPoint", "Button", "Text", "Player",
] as const;

interface Entry {
  label: string;
  signature: string;
  documentation: string;
  kind: "namespace" | "method" | "field" | "callback" | "guard";
  owner: string;
}

function clean(value: string): string {
  return value
    .replaceAll(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replaceAll(/[*`]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function sectionAfter(heading: string, level: number): string {
  const marker = `${"#".repeat(level)} ${heading}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing Lua API heading: ${marker}`);
  const contentStart = source.indexOf("\n", start) + 1;
  const headingPattern = new RegExp(`^#{1,${level}}\\s`, "m");
  const match = headingPattern.exec(source.slice(contentStart));
  return source.slice(contentStart, match === null ? undefined : contentStart + match.index).trim();
}

const entries: Entry[] = [];
for (const name of namespaceNames) {
  const section = sectionAfter(`\`${name}\``, 3);
  entries.push({
    label: name,
    signature: name,
    documentation: clean(section.split("\n\n")[0] ?? `${name} namespace`),
    kind: "namespace",
    owner: name,
  });
}

const methodPattern = /^#### `([a-z_]+):([^`]+)`$/gm;
for (const match of source.matchAll(methodPattern)) {
  const owner = match[1];
  const member = match[2];
  if (owner === undefined || member === undefined || !namespaceNames.includes(owner as typeof namespaceNames[number])) continue;
  const heading = `${owner}:${member}`;
  const section = sectionAfter(`\`${heading}\``, 4);
  entries.push({
    label: heading.replace(/\(.*/, ""),
    signature: heading,
    documentation: clean(section.split("\n\n")[0] ?? heading),
    kind: "method",
    owner,
  });
}

for (const proxy of proxyNames) {
  const section = sectionAfter(proxy, 3);
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const columns = line.split("|").slice(1, -1).map(clean);
    const member = columns[0];
    const declared = columns[1];
    const behavior = columns[2];
    if (member === undefined || declared === undefined || behavior === undefined || member === "Member") continue;
    const inlineSignature = /`([^`]+)`/.exec(line.split("|")[2] ?? "")?.[1];
    const kind = declared.startsWith("Field:") ? "field" : "method";
    entries.push({
      label: kind === "field" ? `${proxy}.${member}` : (inlineSignature ?? `${proxy}:${member}`).replace(/\(.*/, ""),
      signature: inlineSignature ?? `${proxy}.${member}: ${declared.replace(/^Field:\s*/, "")}`,
      documentation: behavior,
      kind,
      owner: proxy,
    });
  }
}

const callbackSections = [
  ["Game callbacks", "callback"],
  ["Entity callbacks", "callback"],
] as const;
for (const [heading, kind] of callbackSections) {
  for (const line of sectionAfter(heading, 3).split("\n")) {
    if (!line.startsWith("| `")) continue;
    const columns = line.split("|").slice(1, -1).map(clean);
    const signature = columns[0];
    const documentation = columns[1];
    if (signature === undefined || documentation === undefined || signature === "Callback") continue;
    entries.push({ label: signature.replace(/\(.*/, ""), signature, documentation, kind, owner: heading });
  }
}
for (const match of sectionAfter("Guards", 3).matchAll(/^- `([^`]+)`/gm)) {
  const signature = match[1];
  if (signature !== undefined) {
    entries.push({
      label: signature.replace(/\(.*/, ""),
      signature,
      documentation: "Read-only guard. Return allow/deny and optionally a user-facing reason.",
      kind: "guard",
      owner: "Guards",
    });
  }
}

const manifest = {
  version: 1,
  generatedFrom: "docs/lua-api.md",
  namespaces: namespaceNames,
  proxies: proxyNames,
  entries: entries.sort((left, right) => left.label.localeCompare(right.label)),
};
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
