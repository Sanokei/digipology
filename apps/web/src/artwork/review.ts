import type { GenerationReview } from "../editor/state/generationReview";
import type { ArtworkReviewResult } from "./model";

/** A matching hash alone is not evidence that actual gameplay checks passed. */
export function acceptedArtworkReview(manifestHash: string, result: ArtworkReviewResult): GenerationReview {
  if (result.manifestHash !== manifestHash) throw new Error("The game changed during its checks. Retry checks for the current draft.");
  if (!Array.isArray(result.validationReport) || !result.validationReport.length || result.validationReport.some((item) => !item || item.ok !== true) ||
      !result.validationReport.some((item) => item.check === "playability" && item.ok)) {
    throw new Error("The updated draft did not pass all gameplay checks. The previous review is preserved.");
  }
  if (!Array.isArray(result.qualityReport) || result.qualityReport.some((item) => !item || typeof item.code !== "string" || !item.code || typeof item.message !== "string" || !["error", "warning"].includes(item.severity))) {
    throw new Error("The game-check response was incomplete. Retry checks; the previous review is preserved.");
  }
  if (result.qualityReport.some((item) => item.severity === "error")) throw new Error("The updated draft needs gameplay fixes. Open the editor and retry checks after making changes.");
  return { manifestHash, warnings: result.qualityReport.filter((item) => item.severity === "warning").slice(0, 256)
    .map((item) => ({ code: item.code.slice(0, 80), message: item.message.slice(0, 2000) })) };
}
