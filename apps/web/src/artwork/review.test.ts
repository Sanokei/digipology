import { expect, test } from "bun:test";
import { acceptedArtworkReview } from "./review";
import type { ArtworkReviewResult } from "./model";

const HASH = `sha256:${"a".repeat(64)}`;
const result = (): ArtworkReviewResult => ({ manifestHash: HASH,
  validationReport: [{ check: "playability", ok: true }],
  qualityReport: [{ code: "game_win_unobserved", message: "Try the ending at the table", severity: "warning" }] });

test("only actual successful current-version checks rebind the review and retain playtest warnings", () => {
  expect(acceptedArtworkReview(HASH, result())).toEqual({ manifestHash: HASH, warnings: [{ code: "game_win_unobserved", message: "Try the ending at the table" }] });
});

test("a reply for an earlier manifest cannot mark edited rules or artwork reviewed", () => {
  expect(() => acceptedArtworkReview(`sha256:${"b".repeat(64)}`, result())).toThrow("changed during its checks");
});

test("an empty, failing or incomplete check response cannot clear an earlier stale review", () => {
  for (const validationReport of [[], [{ check: "playability" as const, ok: false }], [{ check: "manifest_hash" as const, ok: true }]]) {
    expect(() => acceptedArtworkReview(HASH, { ...result(), validationReport })).toThrow("did not pass all gameplay checks");
  }
  expect(() => acceptedArtworkReview(HASH, { ...result(), qualityReport: undefined } as unknown as ArtworkReviewResult)).toThrow("incomplete");
});

test("quality errors keep a matching-hash draft unreviewed", () => {
  expect(() => acceptedArtworkReview(HASH, { ...result(), qualityReport: [{ code: "game_no_progress", message: "No meaningful action", severity: "error" }] })).toThrow("needs gameplay fixes");
});
