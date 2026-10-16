import type { ModelRequest } from "./request";

export type ModelFetch = (
  payload: ModelRequest,
  timeoutMs: number,
) => Promise<unknown | null>;

// Local-first default: Qwen3-0.6B via llama-server (OpenAI-compatible /v1).
// An explicitly empty baseUrl opts out of the default and means "unconfigured".
export const DEFAULT_MODEL_BASE_URL = "http://127.0.0.1:8081/v1";
export const DEFAULT_MODEL_ID =
  "/home/hatch/workspace/anascummis/apps/studio/.runtime/Qwen3-0.6B-Q4_0.gguf";

export function makeModelFetch(options: {
  apiKey?: string;
  baseUrl?: string;
}): ModelFetch | null {
  // Null ONLY when both are empty: an explicitly empty baseUrl (e.g.
  // AI_BASE_URL: "" in wrangler = deliberately unconfigured) plus no key.
  // An undefined baseUrl falls back to the local default below.
  const baseUrlInput = options.baseUrl?.trim();
  const apiKey = options.apiKey?.trim() || undefined;
  if (baseUrlInput === "" && !apiKey) return null;

  const baseUrl = (baseUrlInput || DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");
  return async (payload, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      // llama-server needs no key: omit Authorization entirely when absent.
      if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      return response.ok ? data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
