import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AiRuleSource } from "../../packages/protocol/src/ai-rule-sources";

/** Author-linked single-tab CSV exports retrieved 2026-10-29. No source cells are redistributed here. */
export const MERLIN_CATALOGS = [
  { key: "golems", name: "Golems.csv", document: "1OZ1VNpAdI9pgCz3ABLtk_JlO-WIH3AVhC6CePLWlYdw", bytes: 3870, sha256: "37b2f225c0259ef049455eba46100ebbb2bcab5f59a8171e97ae51dfc55fb90d", layout: "names", definitions: 8 },
  { key: "royal-guards", name: "Royal Guards.csv", document: "1oR_GGQ7mE0Ifk6mvFQT2kStIF9xHH14KWQGaUUn0XQo", bytes: 1868, sha256: "7552076e0e321a40614be8608cdb047abbbcba296590e0e772aed8927880fae3", layout: "names", definitions: 4 },
  { key: "tea-leaves", name: "Tea Leaves.csv", document: "1mln7ndSg52FSPz6Z5Kf-UkgITCrnG1t0a4z5Ubkw8B8", bytes: 2905, sha256: "2fbbd21a824f483a820b7f65c077b33a1d401c14bdfee3a86bb1d0d9cf5d158e", layout: "copies", definitions: 12 },
  { key: "crystal-ball", name: "Crystal Ball.csv", document: "1g9HAlmH1Eswke9tEnsAtYjEWmOQAgdGKqmTda7zncdY", bytes: 5134, sha256: "4453c33fcb95bf2c64805acec98b0c854bdf94b204273ee0716e0510f9e6f9cb", layout: "copies", definitions: 26 },
  { key: "spells", name: "Spells.csv", document: "1M5d9waSGGzukIwMvnTL5MiPquYq5DETy_wEPh_B6LJk", bytes: 5191, sha256: "037d2702a3136c1691eeb7ee5a344eb63cb85d050bd2db3f4501ad16ce344412", layout: "copies", definitions: 17 },
  { key: "potions", name: "Potions.csv", document: "18evShnnRvlaVsq7sUKmxrQkjo0443bS5MyTJtERJ55o", bytes: 8409, sha256: "7fe17c03c3dbab6439360bda8f81b7f4ae5f7f8a965fb27f57aa1bc03cd1b471", layout: "copies", definitions: 7 },
  { key: "royal-decrees", name: "Royal Decrees.csv", document: "1uNEaoNqAAULFk0Fa7pxtpMfLCR0uX1N1TvsdwP6tnk4", bytes: 6400, sha256: "32b9eb0c6692b609ca57523c910c2d6f1a3befced4a7774ae4d5e7fc5d061991", layout: "names", definitions: 14 },
] as const;
export const catalogUrl = (document: string) => `https://docs.google.com/spreadsheets/d/${document}/export?format=csv`;
export const sourceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** CSV analysis only: references always retain the original complete text. */
export function csvRows(source: string): string[][] {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const endCell = () => { row.push(cell); cell = ""; closed = false; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ",") endCell();
    else if (c === "\r" || c === "\n") { endRow(); if (c === "\r" && text[i + 1] === "\n") i++; }
    else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting; preserve and inspect the original export.");
      cell += c;
    }
    if (row.length > 64 || rows.length > 10_000) throw new Error("CSV analysis exceeds its row/column budget.");
  }
  if (quoted) throw new Error("Unterminated CSV field; the source is incomplete.");
  if (cell || row.length || closed) endRow();
  return rows;
}
function count(value: string | undefined): number | null {
  if (!value || !/^\d+(?:\.0+)?$/.test(value.trim())) return null;
  const number = Number(value); return Number.isSafeInteger(number) ? number : null;
}
export function analyzeCatalog(text: string, layout: "copies" | "names") {
  const rows = csvRows(text);
  if (!rows.length) throw new Error("Empty catalog; never replace it with invented definitions.");
  if (layout === "names") return { rows: rows.length, definitions: rows.slice(1).filter((row) => row[0]?.trim()).length,
    declaredCopies: null, listedCopies: null, countConflict: false, zeroCopyRows: [] as number[] };
  const entries = rows.slice(2).flatMap((row, index) => {
    const copies = count(row[0]);
    return row[2]?.trim() && copies !== null ? [{ copies, row: index + 3 }] : [];
  });
  const declaredCopies = count(rows[1]?.[0]);
  if (declaredCopies === null || !entries.length) throw new Error("The catalog has no declared/card-copy counts; record the source gap.");
  const listedCopies = entries.reduce((sum, entry) => sum + entry.copies, 0);
  return { rows: rows.length, definitions: entries.length, declaredCopies, listedCopies,
    countConflict: declaredCopies !== listedCopies, zeroCopyRows: entries.filter((entry) => entry.copies === 0).map((entry) => entry.row) };
}

export async function loadMerlinCatalogs(directory: string) {
  return Promise.all(MERLIN_CATALOGS.map(async (catalog) => {
    const path = join(directory, `${catalog.key}.csv`);
    if ((await stat(path)).size !== catalog.bytes) throw new Error(`${catalog.name} byte length differs from the pinned export; do not silently use another version.`);
    const bytes = await readFile(path), hash = sourceHash(bytes);
    if (hash !== catalog.sha256) throw new Error(`${catalog.name} SHA-256 differs from the pinned export: ${hash}`);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const analysis = analyzeCatalog(text, catalog.layout);
    if (analysis.definitions !== catalog.definitions) throw new Error(`${catalog.name} definition analysis changed; inspect the source before generating.`);
    const sourceUrl = catalogUrl(catalog.document);
    return { reference: { name: catalog.name, text, sourceUrl } satisfies AiRuleSource,
      receipt: { key: catalog.key, name: catalog.name, sourceUrl, bytes: bytes.length, sha256: hash, completeTextIncluded: true, ...analysis } };
  }));
}
