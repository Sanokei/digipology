import type { DeepSeekRequest } from "./request";

export type DeepseekFetch = (
  payload: DeepSeekRequest,
  timeoutMs: number,
) => Promise<unknown | null>;

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export function makeDeepseekFetch(options: {
  apiKey: string | undefined;
  baseUrl?: string;
}): DeepseekFetch | null {
  if (!options.apiKey) return null;

  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/+$/, "");
  return async (payload, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
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
