import { CHECKERS_GAME } from "./games/checkers";
import { DICE_DASH_GAME } from "./games/dice-dash";
import { FIRST_DEAL_GAME } from "./games/first-deal";
import { HEARTHLANDS_GAME } from "./games/hearthlands";
import { ZONE_RUNNER_GAME } from "./games/zone-runner";
import type { BuiltinGame, ReleaseBundle } from "./types";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const BUILTIN_GAMES: ReadonlyArray<BuiltinGame> = deepFreeze([
  FIRST_DEAL_GAME,
  DICE_DASH_GAME,
  ZONE_RUNNER_GAME,
  CHECKERS_GAME,
  HEARTHLANDS_GAME,
]);

export function getBuiltinRelease(releaseId: string): ReleaseBundle | undefined {
  for (const game of BUILTIN_GAMES) {
    const release = game.releases.find((candidate) => candidate.releaseId === releaseId);
    if (release !== undefined) return release;
  }
  return undefined;
}
