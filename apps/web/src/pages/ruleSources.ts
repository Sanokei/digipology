import { rawContentHash, validateAiRuleSources, validateCreateAiGameRequest, AI_RULE_SOURCE_MAX_BYTES, type AiRuleSource, type CreateAiGameRequest } from "digipology-protocol/http";
import { sha256 } from "digipology-canonical-json";

export interface RuleSourceFile { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
export function ruleSourceHash(text: string): string { return rawContentHash(text, sha256); }
export function ruleSourceBytes(text: string): number { return new TextEncoder().encode(text).byteLength; }

export async function readRuleSourceFiles(files: readonly RuleSourceFile[], existing: readonly AiRuleSource[]): Promise<AiRuleSource[]> {
  const added: AiRuleSource[] = [];
  for (const file of files) {
    if (!/\.(?:md|markdown|txt|csv|tsv)$/i.test(file.name)) throw new TypeError(`${file.name}: choose a text, Markdown or CSV file.`);
    if (file.size > AI_RULE_SOURCE_MAX_BYTES) throw new RangeError(`${file.name}: source documents together must fit within 128 KiB.`);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
    catch { throw new TypeError(`${file.name}: this file is not readable UTF-8 text.`); }
    added.push({ name: file.name, text });
  }
  const checked = validateAiRuleSources([...existing, ...added]);
  if (!checked.ok) throw new TypeError(checked.error);
  return checked.value;
}

export function generationRequest(prompt: string, sources: readonly AiRuleSource[]): CreateAiGameRequest {
  const checked = validateCreateAiGameRequest({ prompt: prompt.trim(), ...(sources.length ? { references: sources } : {}) });
  if (!checked.ok) throw new TypeError(checked.error.message);
  return checked.value;
}
