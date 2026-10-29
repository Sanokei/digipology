import { expect, test } from "bun:test";
import { AI_RULE_SOURCE_MAX_BYTES, validateCreateAiGameRequest, validateEditAiGameRequest } from "./http";

const document = { name: "Rulebook.md", text: "\uFEFF# Wizard’s economy\r\nKeep trailing spaces  \n", sourceUrl: "https://github.com/SidewaysTurtle/MerlinEconomics/blob/main/Rulebook.md" };
test("complete source text and public provenance survive both request forms without trimming", () => {
  expect(validateCreateAiGameRequest({ prompt: "Use the attached rules", references: [document] })).toEqual({ ok: true, value: { prompt: "Use the attached rules", references: [document] } });
  expect(validateEditAiGameRequest({ instruction: "Apply these rules", references: [document] })).toMatchObject({ ok: true, value: { references: [document] } });
});
test("the source budget counts combined UTF-8 bytes and permits the full Merlin-sized rulebook", () => {
  expect(validateCreateAiGameRequest({ prompt: "Merlin", references: [{ name: "Rulebook.md", text: "m".repeat(65_833) }] }).ok).toBe(true);
  const full = "é".repeat(AI_RULE_SOURCE_MAX_BYTES / 2);
  expect(validateCreateAiGameRequest({ prompt: "Exact limit", references: [{ name: "Book", text: full }] }).ok).toBe(true);
  expect(validateCreateAiGameRequest({ prompt: "Over limit", references: [{ name: "Book", text: full }, { name: "Cards", text: "x" }] }).ok).toBe(false);
  expect(validateCreateAiGameRequest({ prompt: "Still bounded", references: [{ name: "Book", text: full + "é" }] }).ok).toBe(false);
});
test("binary, damaged, duplicate, credential-bearing and unknown source data cannot pass as a valid set", () => {
  for (const references of [null, [{ ...document, text: "" }], [{ ...document, text: "binary\0data" }], [{ ...document, text: "\ud800" }], [document, document], Array.from({ length: 9 }, (_, n) => ({ name: `Book ${n}`, text: "x" })), [{ ...document, sha256: "invented" }], [{ ...document, sourceUrl: "javascript:alert(1)" }], [{ ...document, sourceUrl: "https://username:password@example.com/private" }]]) {
    expect(validateCreateAiGameRequest({ prompt: "Use actual rules", references }).ok).toBe(false);
  }
  expect(validateCreateAiGameRequest({ prompt: "Old exact contract", extra: true }).ok).toBe(false);
});
