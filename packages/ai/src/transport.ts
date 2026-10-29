import { applyModelProfile, type ModelProfile, type ModelRequest } from "./request";

export type ModelFetch = (
  payload: ModelRequest,
  timeoutMs: number,
) => Promise<unknown | null>;

// Kept as empty compatibility exports. No endpoint or model is inferred.
export const DEFAULT_MODEL_BASE_URL = "";
export const DEFAULT_MODEL_ID = "";
export const LOCAL_MODEL_BASE_URL = "http://127.0.0.1:8081/v1";

export function makeModelFetch(options: {
  apiKey?: string;
  baseUrl?: string;
  profile?: ModelProfile;
}): ModelFetch | null {
  const baseUrlInput = options.baseUrl?.trim();
  const apiKey = options.apiKey?.trim() || undefined;
  if (!baseUrlInput) return null;
  let endpoint: URL;
  try {
    const base = new URL(baseUrlInput);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) return null;
    endpoint = new URL(`${base.href.replace(/\/+$/, "")}/chat/completions`);
  } catch { return null; }
  return async (payload, timeoutMs) => {
    if (!payload.model.trim() || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 300_000));
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
      // Apply again after validation feedback appends a fresh user message.
      const { extraBody, ...fields } = applyModelProfile(payload, options.profile ?? "openai-compatible");
      const response = await fetch(endpoint.href, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...extraBody, ...fields }),
        signal: controller.signal,
        // Workers supports manual/follow only. Reject 3xx without forwarding credentials.
        redirect: "manual",
      });
      if (!response.ok) return null;
      const data: unknown = await response.json().catch(() => null);
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
