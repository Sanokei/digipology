/** Remove leaked DeepSeek DSML tags containing U+FF5C fullwidth bars. */
export function stripModelArtifacts(text: string): string {
  return text.replace(/<｜[^>]*>/g, "");
}

/**
 * Remove ```json / ``` markdown fences around a payload. Weak models emit
 * fences even when told not to; stripping them beats rejecting a good draft.
 */
export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const wrapped = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/.exec(trimmed);
  if (wrapped?.[1] !== undefined) return wrapped[1]!.trim();
  return trimmed
    .replace(/^```(?:json)?[ \t]*$/gim, "")
    .replace(/^```[ \t]*$/gim, "")
    .trim();
}

/**
 * Best-effort repair for a length-truncated JSON object. Each attempt closes
 * its open string/containers; on failure it drops the last incomplete element.
 */
export function salvageTruncatedJson(raw: string): unknown | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let text = raw.slice(start).trimEnd();
  for (let attempt = 0; attempt < 64 && text.length > 1; attempt += 1) {
    let inString = false;
    let escaped = false;
    const stack: string[] = [];
    let lastComma = -1;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") stack.pop();
      else if (character === ",") lastComma = index;
    }

    let candidate: string;
    if (inString) {
      candidate = escaped ? text.slice(0, -1) : text;
      candidate += '"';
    } else {
      candidate = text.replace(/[,:\s]+$/, "");
    }
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      candidate += stack[index] === "{" ? "}" : "]";
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      if (lastComma <= 0) return null;
      text = text.slice(0, lastComma);
    }
  }
  return null;
}

function normalizeSafely<T>(
  raw: unknown,
  normalize: (raw: unknown) => T | null,
): T | null {
  try {
    return normalize(raw);
  } catch {
    return null;
  }
}

function parseAndNormalize<T>(
  text: string,
  normalize: (raw: unknown) => T | null,
): T | null {
  try {
    return normalizeSafely(JSON.parse(text) as unknown, normalize);
  } catch {
    return null;
  }
}

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseCleanSalvage<T>(
  text: string,
  normalize: (raw: unknown) => T | null,
): T | null {
  const verbatim = parseAndNormalize(text, normalize);
  if (verbatim !== null) return verbatim;

  const cleaned = stripModelArtifacts(text);
  const parsedCleaned = parseAndNormalize(cleaned, normalize);
  if (parsedCleaned !== null) return parsedCleaned;

  return normalizeSafely(salvageTruncatedJson(cleaned), normalize);
}

/**
 * Extract a normalized payload through the production failure-mode ladder:
 * individual tool calls, joined cleaned calls, truncation salvage, and the
 * raw-JSON content path. Tool calling does not work against llama-server +
 * Qwen3-0.6B (the model never emits tool_calls), so the raw-JSON rungs are
 * the production path; the tool-call rungs stay for backends that support
 * them.
 */
export function extractToolPayload<T>(
  response: unknown,
  normalize: (raw: unknown) => T | null,
): T | null {
  const choices = (response as { choices?: unknown } | null)?.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const message = (firstChoice as { message?: unknown } | null)?.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;

  const record = message as Record<string, unknown>;
  const calls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  const argumentsTexts: string[] = [];
  for (const call of calls) {
    const fn = (call as { function?: unknown } | null)?.function;
    const argumentsText = (fn as { arguments?: unknown } | null)?.arguments;
    if (typeof argumentsText === "string") argumentsTexts.push(argumentsText);
  }

  // Rung 1: a complete call wins verbatim. Do not strip valid string content.
  for (const text of argumentsTexts) {
    const value = parseAndNormalize(text, normalize);
    if (value !== null) return value;
  }

  const joined = argumentsTexts.join("");
  if (joined.length > 0) {
    // Rung 2: split calls and leaked DSML tags become one clean JSON document.
    const cleaned = stripModelArtifacts(joined);
    const value = parseAndNormalize(cleaned, normalize);
    if (value !== null) return value;

    // Rung 3: a max-token cut may still contain a useful intact prefix.
    const salvaged = normalizeSafely(salvageTruncatedJson(cleaned), normalize);
    if (salvaged !== null) return salvaged;
  }

  // Rung 4: the raw-JSON path. The model may return the payload as the whole
  // content (possibly fenced or truncated), or embed it inside prose.
  if (typeof record.content === "string") {
    const unfenced = stripMarkdownFences(record.content);
    const whole = parseCleanSalvage(unfenced, normalize);
    if (whole !== null) return whole;

    const objectText = firstBalancedObject(unfenced);
    if (objectText !== null) {
      const embedded = parseCleanSalvage(objectText, normalize);
      if (embedded !== null) return embedded;
    }
  }

  return null;
}
