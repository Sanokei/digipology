import type { GameSummaryDto } from "digipology-protocol/http";

// #43 merged: the protocol DTO now carries the quickplay metrics directly.
// gameMetrics stays defensive at runtime because responses are not validated client-side.
export type CatalogGameSummaryDto = GameSummaryDto;

export interface CatalogGamesResponse {
  games: CatalogGameSummaryDto[];
}

export interface QuickPlayRequest {
  slug: string;
  displayName?: string;
}

export interface QuickPlayResponse {
  roomId: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
  releaseId: string;
  joinCode: string;
}

export function gameMetrics(game: CatalogGameSummaryDto): {
  currentPlayers: number;
  totalPlays: number;
  coverVersion: number | null;
} {
  return {
    currentPlayers: finiteNonNegative(game.currentPlayers),
    totalPlays: finiteNonNegative(game.totalPlays),
    coverVersion: typeof game.coverVersion === "number" && Number.isFinite(game.coverVersion)
      ? game.coverVersion
      : null,
  };
}

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function gameCoverUrl(game: CatalogGameSummaryDto): string | null {
  const { coverVersion } = gameMetrics(game);
  return coverVersion === null
    ? null
    : `/api/games/${encodeURIComponent(game.slug)}/cover?v=${encodeURIComponent(String(coverVersion))}`;
}
