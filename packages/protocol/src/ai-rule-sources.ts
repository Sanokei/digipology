/** Creator source documents are request metadata; never canonical game state. */
export interface AiRuleSource {
  name: string;
  text: string;
  sourceUrl?: string;
}
export const AI_RULE_SOURCE_MAX_FILES = 8;
export const AI_RULE_SOURCE_MAX_BYTES = 128 * 1024;
export type AiRuleSourceValidation = { ok: true; value: AiRuleSource[] } | { ok: false; error: string };

/** Preserve accepted text byte-for-byte; reject unknown fields and partial sets. */
export function validateAiRuleSources(value: unknown): AiRuleSourceValidation {
  const fail = (error: string): AiRuleSourceValidation => ({ ok: false, error });
  if (!Array.isArray(value) || value.length > AI_RULE_SOURCE_MAX_FILES) return fail("Attach at most 8 rule or card documents.");
  const sources: AiRuleSource[] = [];
  const names = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("Each source must contain a name and text.");
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["name", "text", "sourceUrl"].includes(key))) return fail("Source documents contain an unknown field.");
    if (typeof raw.name !== "string" || raw.name.trim() !== raw.name || !raw.name || raw.name.length > 120 || /[\u0000-\u001f\u007f]/.test(raw.name)) return fail("Give each source a name of 1 to 120 characters.");
    if (names.has(raw.name)) return fail(`A source named ${raw.name} is already attached. Remove it before replacing it.`);
    names.add(raw.name);
    if (typeof raw.text !== "string" || !raw.text.trim() || raw.text.length > AI_RULE_SOURCE_MAX_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw.text)) return fail(`${raw.name}: choose a nonempty UTF-8 text, Markdown or CSV document within 128 KiB.`);
    const bytes = new TextEncoder().encode(raw.text);
    if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== raw.text) return fail(`${raw.name}: the source contains invalid Unicode.`);
    total += bytes.byteLength;
    if (total > AI_RULE_SOURCE_MAX_BYTES) return fail("Source documents together must fit within 128 KiB. No text was truncated.");
    if (raw.sourceUrl !== undefined) {
      if (typeof raw.sourceUrl !== "string" || raw.sourceUrl.length > 2048 || raw.sourceUrl !== raw.sourceUrl.trim()) return fail(`${raw.name}: enter a public HTTP or HTTPS source URL.`);
      try {
        const url = new URL(raw.sourceUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return fail(`${raw.name}: enter a public HTTP or HTTPS source URL without credentials.`);
      } catch { return fail(`${raw.name}: enter a public HTTP or HTTPS source URL.`); }
    }
    sources.push({ name: raw.name, text: raw.text, ...(raw.sourceUrl === undefined ? {} : { sourceUrl: raw.sourceUrl }) });
  }
  return { ok: true, value: sources };
}
