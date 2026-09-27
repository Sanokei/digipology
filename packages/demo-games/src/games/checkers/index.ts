import type { CoverSpec } from "digipology-covers";
import generatedRelease1 from "./release-1.generated";
import generatedRelease2 from "./release-2.generated";
import type { BuiltinGame, ReleaseBundle } from "../../types";

const coverSpec = {
  palette: ["#17171c", "#b73535", "#e8d7b5", "#6f4327"], layout: "grid", motif: "abstract",
  titleTreatment: "boxed", seed: 2_408_064,
} satisfies CoverSpec;

export const CHECKERS_GAME: BuiltinGame = {
  slug: "checkers", title: "Tabletop Classics — Checkers",
  tagline: "Crown your men and clear the board in a timeless two-player classic.", minPlayers: 2, maxPlayers: 2,
  tags: ["strategy", "classic", "abstract"], playTimeMinutes: 30, complexity: 2,
  description: "Play classic checkers on an 8×8 board. Move pieces freely in sandbox mode and flip a man when it reaches the far edge to crown it.",
  coverSpec, latestReleaseId: generatedRelease2.releaseId,
  releases: [generatedRelease1 as unknown as ReleaseBundle, generatedRelease2 as unknown as ReleaseBundle],
};
