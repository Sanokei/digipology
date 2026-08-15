import { expect, test } from "bun:test";

import { classifyRendererTier, type RendererDeviceProfile } from "./rendererPolicy";

const cases: readonly [string, RendererDeviceProfile, "default" | "low"][] = [
  ["unknown desktop profile", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "default"],
  ["typical desktop", { deviceMemory: 8, hardwareConcurrency: 8, userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, "default"],
  ["memory-constrained desktop", { deviceMemory: 2, hardwareConcurrency: 8 }, "low"],
  ["CPU-constrained desktop", { deviceMemory: 8, hardwareConcurrency: 2 }, "low"],
  ["budget Android phone", { deviceMemory: 4, hardwareConcurrency: 4, mobile: true }, "low"],
  ["mobile UA fallback", { deviceMemory: 4, hardwareConcurrency: 8, userAgent: "Mozilla/5.0 (Linux; Android 14; Mobile)" }, "low"],
  ["recent Android phone", { deviceMemory: 8, hardwareConcurrency: 8, mobile: true }, "default"],
  ["older iOS Safari without deviceMemory", { hardwareConcurrency: 4, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148" }, "low"],
  ["newer iOS Safari without deviceMemory", { hardwareConcurrency: 6, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" }, "default"],
  ["invalid hints", { deviceMemory: Number.NaN, hardwareConcurrency: 0, mobile: false }, "default"],
];

for (const [name, profile, expected] of cases) {
  test(`renderer tier: ${name}`, () => {
    expect(classifyRendererTier(profile)).toBe(expected);
  });
}
