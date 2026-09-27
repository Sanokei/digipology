import type { CoverSpec } from "digipology-covers";
import type { BuiltinGame, ReleaseBundle } from "../../types";
import generatedRelease from "./release-1.generated";

const coverSpec = {
  palette: ["#173f48", "#d8b35d", "#48794e", "#a75236"],
  layout: "radial", motif: "meeples", titleTreatment: "stacked", seed: 8_341_906,
} satisfies CoverSpec;

export const HEARTHLANDS_GAME: BuiltinGame = {
  slug: "hearthlands",
  title: "Hearthlands",
  tagline: "Settle a changing island, open trade routes, and grow a thriving homeland.",
  minPlayers: 3,
  maxPlayers: 6,
  tags: ["strategy", "trading", "hex-grid", "family"],
  playTimeMinutes: 90,
  complexity: 3,
  description: "A 3–6 player hex-island game of production, negotiation, trails, harbors, and hidden Chronicles. Includes a larger deterministic map for five or six players. Rules: docs/games/hearthlands.md",
  coverSpec,
  latestReleaseId: generatedRelease.releaseId,
  releases: [generatedRelease as unknown as ReleaseBundle],
};
