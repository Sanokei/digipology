/**
 * USD per one million tokens. This is the conservative (higher) published
 * DeepSeek chat pricing tier used by the production harness; over-counting is
 * the safe direction for downstream spending caps.
 */
export const DEEPSEEK_USD_PER_M = {
  cacheHit: 0.07,
  cacheMiss: 0.56,
  output: 1.68,
} as const;

function tokens(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function usageUsd(usage: unknown): number {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return 0;
  const record = usage as Record<string, unknown>;
  const prompt = tokens(record.prompt_tokens);
  const hit = Math.min(tokens(record.prompt_cache_hit_tokens), prompt);
  const missRaw = tokens(record.prompt_cache_miss_tokens);
  const miss =
    missRaw > 0
      ? Math.min(missRaw, Math.max(0, prompt - hit))
      : Math.max(0, prompt - hit);
  const output = tokens(record.completion_tokens);
  return (
    (hit * DEEPSEEK_USD_PER_M.cacheHit +
      miss * DEEPSEEK_USD_PER_M.cacheMiss +
      output * DEEPSEEK_USD_PER_M.output) /
    1_000_000
  );
}

export function responseUsd(response: unknown): number {
  return usageUsd((response as { usage?: unknown } | null)?.usage);
}

export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
