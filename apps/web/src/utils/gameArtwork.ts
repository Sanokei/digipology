import type { GameSummaryDto } from "digipology-protocol/http";
import { gameCoverUrl } from "../api/quickplayAdapter";

const BUILTIN_ARTWORK: Readonly<Record<string, string>> = {
  "first-deal": "/art/first-deal.webp",
  "dice-dash": "/art/dice-dash.webp",
  "zone-runner": "/art/zone-runner.webp",
};

/** Built-in artwork is shipped with the app; community covers stay release-versioned. */
export function gameArtwork(game: GameSummaryDto): string | null {
  return (game.builtin ? BUILTIN_ARTWORK[game.slug] : undefined) ?? gameCoverUrl(game);
}
