import type { CanonicalGameState } from "digipology-kernel";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface GameProgress {
  currentPlayerId: string | null;
  winnerId: string | null;
  status: string | null;
  scores: Array<{ playerId: string; name: string; value: number }>;
}

/** Presentation of the documented creator stdlib; never changes canonical state. */
export function gameProgress(state: CanonicalGameState | null): GameProgress {
  const script = record(state?.scriptState);
  const stdlib = record(script.__stdlib);
  const turns = record(stdlib.turns);
  const order = Array.isArray(turns.order) ? turns.order : [];
  const current = turns.active === true && typeof turns.index === "number" ? order[turns.index - 1] : undefined;
  const values = record(stdlib.scores);
  const winnerId = typeof script.winner_id === "string" ? script.winner_id : null;
  const scores = Object.values(state?.seats ?? {}).sort((a, b) => a.id.localeCompare(b.id)).flatMap((seat) => {
    if (typeof seat.playerId !== "string") return [];
    const player = state?.players[seat.playerId];
    if (player === undefined) return [];
    const value = values[player.id] ?? (typeof seat.scoreId === "string" ? state?.entities[seat.scoreId]?.components.counter?.value : undefined);
    return typeof value === "number" ? [{ playerId: player.id, name: typeof player.name === "string" ? player.name : "Player", value }] : [];
  });
  const status = state?.entities.status?.components.text?.value;
  return {
    currentPlayerId: typeof current === "string" ? current : null,
    winnerId, status: typeof status === "string" && status !== "" ? status : null, scores,
  };
}
