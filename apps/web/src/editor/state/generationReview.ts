export interface GenerationReview {
  manifestHash: string;
  warnings: Array<{ code: string; message: string }>;
}

/** Corrupt optional review metadata must not make an otherwise valid draft unreadable. */
export function normalizeGenerationReview(value: unknown): GenerationReview | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const review = value as Record<string, unknown>;
  if (typeof review.manifestHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(review.manifestHash) || !Array.isArray(review.warnings) || review.warnings.length > 256) return undefined;
  const warnings: GenerationReview["warnings"] = [];
  for (const item of review.warnings) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
    const warning = item as Record<string, unknown>;
    if (typeof warning.code !== "string" || !warning.code || warning.code.length > 80 || typeof warning.message !== "string" || warning.message.length > 2_000) return undefined;
    warnings.push({ code: warning.code, message: warning.message });
  }
  return { manifestHash: review.manifestHash, warnings };
}
