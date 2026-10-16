/**
 * Request counting for the local Qwen model. The local model costs $0, so
 * usage is metered in requests (for the daily abuse-protection cap), not dollars.
 * Replaces the old DeepSeek USD metering (DEEPSEEK_USD_PER_M / usageUsd / responseUsd).
 */
export function responseRequests(response: unknown): number {
  return response == null ? 0 : 1;
}

export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
