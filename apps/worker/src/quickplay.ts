export const QUICKPLAY_MAX_ATTEMPTS = 3;
export const ROOM_HEARTBEAT_INTERVAL_MS = 30_000;
export const ROOM_HEARTBEAT_STALE_MS = ROOM_HEARTBEAT_INTERVAL_MS * 2;

export interface QuickPlayCandidate {
  roomId: string;
  joinCode: string;
  playerCount: number;
  maxPlayers: number;
  lastHeartbeatAt: number | null;
}

export type QuickPlayJoinOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "full" | "ended" | "not_found" };

export interface QuickPlayOperations<T> {
  select(): Promise<readonly QuickPlayCandidate[]>;
  claim(candidate: QuickPlayCandidate): Promise<boolean>;
  join(candidate: QuickPlayCandidate): Promise<QuickPlayJoinOutcome<T>>;
  reconcile(candidate: QuickPlayCandidate, outcome: "full" | "ended" | "not_found"): Promise<void>;
}

export type QuickPlayMatchResult<T> =
  | { decision: "joined"; candidate: QuickPlayCandidate; value: T; attempts: number }
  | { decision: "create"; attempts: number };

export function quickPlayAttemptDecision(
  outcome: "claim_lost" | "joined" | "full" | "ended" | "not_found",
  attempt: number,
  maxAttempts = QUICKPLAY_MAX_ATTEMPTS,
): "joined" | "retry" | "create" {
  if (outcome === "joined") return "joined";
  return attempt >= maxAttempts ? "create" : "retry";
}

export function chooseQuickPlayCandidate(
  candidates: readonly QuickPlayCandidate[],
  now: number,
  excludedRoomIds: ReadonlySet<string> = new Set(),
): QuickPlayCandidate | null {
  const freshAfter = now - ROOM_HEARTBEAT_STALE_MS;
  return candidates
    .filter((candidate) =>
      !excludedRoomIds.has(candidate.roomId) &&
      candidate.playerCount >= 0 &&
      candidate.playerCount < candidate.maxPlayers &&
      candidate.lastHeartbeatAt !== null &&
      candidate.lastHeartbeatAt >= freshAfter)
    .sort((left, right) =>
      right.playerCount - left.playerCount ||
      left.roomId.localeCompare(right.roomId))[0] ?? null;
}

/** Deterministic orchestration with all I/O injected for unit-level race simulation. */
export async function runQuickPlayMatchmaking<T>(
  now: number,
  operations: QuickPlayOperations<T>,
  maxAttempts = QUICKPLAY_MAX_ATTEMPTS,
): Promise<QuickPlayMatchResult<T>> {
  const attempted = new Set<string>();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = chooseQuickPlayCandidate(await operations.select(), now, attempted);
    if (candidate === null) return { decision: "create", attempts: attempt - 1 };
    attempted.add(candidate.roomId);
    if (!(await operations.claim(candidate))) {
      if (quickPlayAttemptDecision("claim_lost", attempt, maxAttempts) === "create") break;
      continue;
    }
    const outcome = await operations.join(candidate);
    if (outcome.status === "ok" && quickPlayAttemptDecision("joined", attempt, maxAttempts) === "joined") {
      return { decision: "joined", candidate, value: outcome.value, attempts: attempt };
    }
    if (outcome.status === "ok") throw new Error("Unreachable quick-play decision");
    await operations.reconcile(candidate, outcome.status);
    if (quickPlayAttemptDecision(outcome.status, attempt, maxAttempts) === "create") break;
  }
  return { decision: "create", attempts: maxAttempts };
}
