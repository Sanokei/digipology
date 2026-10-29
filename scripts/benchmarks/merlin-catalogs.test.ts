import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCatalog, csvRows, loadMerlinCatalogs, MERLIN_CATALOGS } from "./merlin-catalogs";

test("quoted multiline CSV, BOM, CRLF and trailing empty cells are analyzed without modifying source text", () => {
  const source = '\uFEFFName,Ability,Other\r\n"Mage, merchant","Pay ""one"" gold\r\nthen draw",\r\n,,\r\n';
  expect(csvRows(source)).toEqual([["Name", "Ability", "Other"], ["Mage, merchant", 'Pay "one" gold\r\nthen draw', ""], ["", "", ""]]);
  expect(source).toStartWith("\uFEFF"); expect(source).toEndWith(",,\r\n");
  expect(() => csvRows('a,b\n"cut off')).toThrow("Unterminated");
  expect(() => csvRows('a,b\n"value"junk,2')).toThrow("Malformed");
});
test("declared/listed conflicts and zero-copy definitions remain distinct instead of correcting the source", () => {
  const source = "Copies,Odds,Name\r\n3,,\r\n2,,First\r\n2,,Second\r\n0,,Retained\r\n,,\r\n";
  expect(analyzeCatalog(source, "copies")).toEqual({ rows: 6, definitions: 3, declaredCopies: 3, listedCopies: 4, countConflict: true, zeroCopyRows: [5] });
  expect(analyzeCatalog("Name,Effect\nGuard,Defend\n,\n", "names")).toMatchObject({ definitions: 1, declaredCopies: null, listedCopies: null });
  expect(source).toContain("3,,\r\n");
});
test("a missing or changed pinned catalog fails before a request packet can be accepted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "merlin-catalog-admission-"));
  try {
    await expect(loadMerlinCatalogs(directory)).rejects.toThrow();
    await Promise.all(MERLIN_CATALOGS.map((catalog) => writeFile(join(directory, `${catalog.key}.csv`), Buffer.alloc(catalog.bytes, 32))));
    await expect(loadMerlinCatalogs(directory)).rejects.toThrow("SHA-256 differs");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
