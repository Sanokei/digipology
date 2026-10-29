import type { ModelProfile } from "digipology-ai";

export interface AiModelSettings {
  model: string;
  profile: ModelProfile;
  generationTokens: number;
  repairTokens: number;
  generationTimeoutMs: number;
  repairTimeoutMs: number;
}

const value = (env: object, name: string) => {
  const input: unknown = Reflect.get(env, name);
  return typeof input === "string" ? input.trim() : "";
};

/** Server configuration only; this never reads or exposes provider credentials. */
export function readAiModelSettings(env: object): AiModelSettings | null {
  const profile = value(env, "AI_PROVIDER_PROFILE") || "openai-compatible";
  if (!["openai-compatible", "openai", "qwen-local"].includes(profile)) return null;
  const budget = (name: string, fallback: number, min: number, max: number) => {
    const input = value(env, name);
    const parsed = input === "" ? fallback : Number(input);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const generationTokens = budget("AI_MAX_OUTPUT_TOKENS", 24_000, 1_024, 65_536);
  const repairTokens = budget("AI_REPAIR_MAX_OUTPUT_TOKENS", 8_000, 512, 32_768);
  const generationTimeoutMs = budget("AI_TIMEOUT_MS", 180_000, 5_000, 300_000);
  const repairTimeoutMs = budget("AI_REPAIR_TIMEOUT_MS", 120_000, 5_000, 300_000);
  if (generationTokens === null || repairTokens === null || generationTimeoutMs === null || repairTimeoutMs === null) return null;
  return { model: value(env, "AI_MODEL"), profile: profile as ModelProfile, generationTokens, repairTokens, generationTimeoutMs, repairTimeoutMs };
}
