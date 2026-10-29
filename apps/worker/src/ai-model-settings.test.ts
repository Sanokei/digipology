import { expect, test } from "bun:test";
import { readAiModelSettings } from "./ai-model-settings";

test("AI settings require an explicitly chosen model and keep bounded independent generation/repair budgets", () => {
  expect(readAiModelSettings({})).toEqual({ model: "", profile: "openai-compatible", generationTokens: 24_000, repairTokens: 8_000, generationTimeoutMs: 180_000, repairTimeoutMs: 120_000 });
  expect(readAiModelSettings({ AI_MODEL: " account-model ", AI_PROVIDER_PROFILE: "openai", AI_MAX_OUTPUT_TOKENS: "32768", AI_REPAIR_MAX_OUTPUT_TOKENS: "4096", AI_TIMEOUT_MS: "240000" }))
    .toMatchObject({ model: "account-model", profile: "openai", generationTokens: 32_768, repairTokens: 4_096, generationTimeoutMs: 240_000 });
});

test("invalid AI profile or budgets stay unconfigured rather than silently selecting a provider or request size", () => {
  for (const setting of [{ AI_PROVIDER_PROFILE: "invented" }, { AI_MAX_OUTPUT_TOKENS: "999999" }, { AI_REPAIR_MAX_OUTPUT_TOKENS: "0" }, { AI_TIMEOUT_MS: "Infinity" }, { AI_TIMEOUT_MS: "2.5" }, { AI_REPAIR_TIMEOUT_MS: "301000" }]) expect(readAiModelSettings(setting)).toBeNull();
});
