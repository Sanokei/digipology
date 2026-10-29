import type { EditorDraft } from "../editor/state/types";

const suggestions: Record<string, string> = {
  game_win_unobserved: "Play through to a winner and check that the ending is clear.",
  game_playtest_stalled: "Check that every turn has a usable next action.",
  game_playtest_coverage_limited: "Try the choices that the automated playtest could not cover.",
  game_no_progress: "Check that actions move the game forward.",
};

export function draftReview(draft: EditorDraft): { stale: boolean; suggestions: string[] } | null {
  const review = draft.generationReview;
  if (!review) return null;
  if (review.manifestHash !== draft.bundle.integrity.manifestHash) return { stale: true, suggestions: ["Try each seat, the choices you changed, and a complete game to a winner."] };
  const items = [...new Set(review.warnings.map((warning) => Object.hasOwn(suggestions, warning.code)
    ? suggestions[warning.code]!
    : "Try every action in the rules and check that the table responds as expected."))];
  return items.length ? { stale: false, suggestions: items } : null;
}
