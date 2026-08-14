import { describe, expect, it } from "bun:test";

import { gameCoverUrl, gameMetrics, type CatalogGameSummaryDto } from "./quickplayAdapter";

const game: CatalogGameSummaryDto = {
  slug: "cards / demo",
  title: "Cards",
  tagline: "",
  minPlayers: 2,
  maxPlayers: 4,
  builtin: true,
  currentPlayers: 0,
  totalPlays: 0,
  coverVersion: null,
};

describe("#43 game summary adapter", () => {
  it("degrades absent and invalid metrics from older server payloads", () => {
    const legacy = { ...game } as Partial<CatalogGameSummaryDto>;
    delete legacy.currentPlayers;
    delete legacy.totalPlays;
    delete legacy.coverVersion;
    expect(gameMetrics(legacy as CatalogGameSummaryDto)).toEqual({ currentPlayers: 0, totalPlays: 0, coverVersion: null });
    expect(gameMetrics({ ...game, currentPlayers: -4, totalPlays: Number.NaN })).toEqual({
      currentPlayers: 0,
      totalPlays: 0,
      coverVersion: null,
    });
  });

  it("builds the versioned, encoded portrait-cover URL only when a cover exists", () => {
    expect(gameCoverUrl(game)).toBeNull();
    expect(gameCoverUrl({ ...game, coverVersion: 7 })).toBe("/api/games/cards%20%2F%20demo/cover?v=7");
  });
});
