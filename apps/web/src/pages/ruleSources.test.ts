import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readRuleSourceFiles, ruleSourceHash, generationRequest } from "./ruleSources";

test("file intake preserves BOM, line endings, Unicode and exact independently measured hashes", async () => {
  const text = "\uFEFF# Merlin Economics\r\nWizard’s ledger  \n";
  const bytes = new TextEncoder().encode(text);
  const sources = await readRuleSourceFiles([new File([bytes], "Rulebook.md")], []);
  expect(sources).toEqual([{ name: "Rulebook.md", text }]);
  expect(ruleSourceHash(sources[0]!.text)).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  expect(generationRequest("  Merlin  ", sources)).toEqual({ prompt: "Merlin", references: sources });
});
test("a bad second file or oversized/duplicate source does not replace the already accepted set", async () => {
  const current = [{ name: "Rules.md", text: "Accepted complete rules" }];
  for (const files of [[new File(["card,ability\n1,magic"], "Cards.csv"), new File([new Uint8Array([0xff])], "Broken.md")], [new File(["x".repeat(131_073)], "Huge.md")], [new File(["duplicate"], "Rules.md")], [new File(["pixels"], "Artwork.png")]]) {
    await expect(readRuleSourceFiles(files, current)).rejects.toThrow();
    expect(current).toEqual([{ name: "Rules.md", text: "Accepted complete rules" }]);
  }
});
test("spreadsheet CSV is source data, and an omitted reference list keeps the old wire contract", async () => {
  expect(await readRuleSourceFiles([new File(["Card,Count,Effect\r\nTaxman,2,Collect tax\r\n"], "Royal Decrees.csv")], [])).toEqual([{ name: "Royal Decrees.csv", text: "Card,Count,Effect\r\nTaxman,2,Collect tax\r\n" }]);
  expect(generationRequest("A new game", [])).toEqual({ prompt: "A new game" });
});
