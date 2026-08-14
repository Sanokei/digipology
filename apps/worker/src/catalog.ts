import { BUILTIN_GAMES, getBuiltinRelease } from "digipology-demo-games";
import type {
  BuiltinGame,
  ReleaseBundle as BuiltinReleaseBundle,
} from "digipology-demo-games";
import type {
  GameSummaryDto,
  ReleaseBundle as ProtocolReleaseBundle,
  ReleaseSummaryDto,
} from "digipology-protocol/http";

export interface CatalogGame extends GameSummaryDto {
  latestReleaseId: string;
}

export interface CatalogRelease extends ReleaseSummaryDto {
  gameSlug: string;
  bundle: ProtocolReleaseBundle;
}

export interface GameCatalog {
  listGames(): readonly CatalogGame[];
  getGame(slug: string): CatalogGame | null;
  getRelease(releaseId: string): CatalogRelease | null;
  resolveRelease(slugOrId: string): CatalogRelease | null;
}

const games: readonly CatalogGame[] = BUILTIN_GAMES.map((game: BuiltinGame) => ({
  slug: game.slug,
  title: game.title,
  tagline: game.tagline,
  minPlayers: game.minPlayers,
  maxPlayers: game.maxPlayers,
  builtin: true,
  latestReleaseId: game.release.releaseId,
}));

const releases: readonly CatalogRelease[] = BUILTIN_GAMES.map((game: BuiltinGame) => {
  const release: BuiltinReleaseBundle | undefined = getBuiltinRelease(game.release.releaseId);
  if (release === undefined) throw new Error(`Missing built-in release ${game.release.releaseId}`);
  return {
    releaseId: release.releaseId,
    gameSlug: game.slug,
    kernelVersion: release.kernelVersion,
    luaApiVersion: release.luaApiVersion,
    bundle: release as unknown as ProtocolReleaseBundle,
  };
});

/** Adapter over the immutable `digipology-demo-games` built-in catalog. */
export const builtinCatalog: GameCatalog = {
  listGames: () => games,
  getGame: (slug) => games.find((game) => game.slug === slug) ?? null,
  getRelease: (releaseId) => releases.find((release) => release.releaseId === releaseId) ?? null,
  resolveRelease: (slugOrId) => {
    const direct = releases.find((release) => release.releaseId === slugOrId);
    if (direct !== undefined) return direct;
    const game = games.find((candidate) => candidate.slug === slugOrId);
    return game === undefined
      ? null
      : releases.find((release) => release.releaseId === game.latestReleaseId) ?? null;
  },
};

export function gameSummary(game: CatalogGame): GameSummaryDto {
  return {
    slug: game.slug,
    title: game.title,
    tagline: game.tagline,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    builtin: game.builtin,
  };
}

export function releaseSummary(release: CatalogRelease): ReleaseSummaryDto {
  return {
    releaseId: release.releaseId,
    kernelVersion: release.kernelVersion,
    luaApiVersion: release.luaApiVersion,
  };
}
