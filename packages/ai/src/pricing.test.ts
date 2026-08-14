import { describe, expect, test } from "bun:test";

import {
  DEEPSEEK_USD_PER_M,
  dayKey,
  responseUsd,
  usageUsd,
} from "./pricing";

describe("DeepSeek pricing", () => {
  test("honors an explicit cache hit/miss split", () => {
    expect(
      usageUsd({
        prompt_tokens: 1_000_000,
        prompt_cache_hit_tokens: 250_000,
        prompt_cache_miss_tokens: 750_000,
        completion_tokens: 100_000,
      }),
    ).toBeCloseTo(0.6055, 12);
  });

  test("prices the whole prompt at cache-miss rate when the split is absent", () => {
    expect(usageUsd({ prompt_tokens: 1_000_000 })).toBe(
      DEEPSEEK_USD_PER_M.cacheMiss,
    );
  });

  test("clamps cache hits to prompt tokens", () => {
    expect(
      usageUsd({
        prompt_tokens: 1_000_000,
        prompt_cache_hit_tokens: 2_000_000,
        prompt_cache_miss_tokens: 2_000_000,
      }),
    ).toBe(DEEPSEEK_USD_PER_M.cacheHit);
  });

  test("malformed fields price as zero and never throw", () => {
    expect(usageUsd(null)).toBe(0);
    expect(usageUsd([])).toBe(0);
    expect(
      usageUsd({
        prompt_tokens: -1,
        prompt_cache_hit_tokens: Number.NaN,
        prompt_cache_miss_tokens: -10,
        completion_tokens: Number.POSITIVE_INFINITY,
      }),
    ).toBe(0);
    expect(usageUsd({})).toBe(0);
  });

  test("known one-million-token vector has exact USD", () => {
    expect(
      usageUsd({
        prompt_tokens: 1_000_000,
        prompt_cache_hit_tokens: 1_000_000,
        completion_tokens: 1_000_000,
      }),
    ).toBe(1.75);
  });

  test("responseUsd reads usage defensively", () => {
    expect(responseUsd({ usage: { completion_tokens: 1_000_000 } })).toBe(
      DEEPSEEK_USD_PER_M.output,
    );
    expect(responseUsd(undefined)).toBe(0);
  });

  test("dayKey uses the UTC calendar day", () => {
    expect(dayKey(new Date("2026-08-13T23:30:00-04:00"))).toBe("2026-08-14");
  });
});
