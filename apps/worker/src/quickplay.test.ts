import { describe, expect, test } from "bun:test";
import {
  QUICKPLAY_MAX_ATTEMPTS,
  ROOM_HEARTBEAT_STALE_MS,
  chooseQuickPlayCandidate,
  quickPlayAttemptDecision,
  runQuickPlayMatchmaking,
  type QuickPlayCandidate,
  type QuickPlayJoinOutcome,
} from "./quickplay";

const NOW = 1_000_000;

function room(roomId: string, playerCount: number, overrides: Partial<QuickPlayCandidate> = {}): QuickPlayCandidate {
  return {
    roomId,
    joinCode: "ABCD-2345",
    playerCount,
    maxPlayers: 4,
    lastHeartbeatAt: NOW,
    joinable: true,
    ...overrides,
  };
}

describe("quick-play matchmaking", () => {
  test("chooses most-filled first while skipping full and stale rooms", () => {
    expect(chooseQuickPlayCandidate([
      room("one", 1), room("three", 3), room("full", 4),
      room("stale", 3, { lastHeartbeatAt: NOW - ROOM_HEARTBEAT_STALE_MS - 1 }),
      room("legacy", 3, { lastHeartbeatAt: null }),
      room("residual", 3, { joinable: false }),
    ], NOW)?.roomId).toBe("three");
  });

  test("excludes residual rooms and preserves most-filled-first among lobby rooms", () => {
    expect(chooseQuickPlayCandidate([
      room("residual", 3, { joinable: false }),
      room("one", 1),
      room("two", 2),
    ], NOW)?.roomId).toBe("two");
    expect(chooseQuickPlayCandidate([
      room("finished", 3, { joinable: false }),
      room("in-progress", 2, { joinable: false }),
    ], NOW)).toBeNull();
  });

  test("accepts the exact one-seat-left and heartbeat freshness edges", () => {
    expect(chooseQuickPlayCandidate([
      room("edge", 3, { lastHeartbeatAt: NOW - ROOM_HEARTBEAT_STALE_MS }),
    ], NOW)).toMatchObject({ roomId: "edge", playerCount: 3, maxPlayers: 4 });
    expect(chooseQuickPlayCandidate([], NOW)).toBeNull();
  });

  test("reduces claim and DO outcomes into bounded pure decisions", () => {
    expect(quickPlayAttemptDecision("joined", 1)).toBe("joined");
    expect(quickPlayAttemptDecision("claim_lost", 1)).toBe("retry");
    expect(quickPlayAttemptDecision("full", QUICKPLAY_MAX_ATTEMPTS)).toBe("create");
    expect(quickPlayAttemptDecision("ended", QUICKPLAY_MAX_ATTEMPTS - 1)).toBe("retry");
    expect(quickPlayAttemptDecision("ineligible", QUICKPLAY_MAX_ATTEMPTS - 1)).toBe("retry");
  });

  test("falls through to create when every selected room is residual", async () => {
    let claims = 0;
    const result = await runQuickPlayMatchmaking(NOW, {
      select: async () => [room("residual", 3, { joinable: false })],
      claim: async () => { claims += 1; return true; },
      join: async () => ({ status: "ineligible" as const }),
      reconcile: async () => {},
    });
    expect(result).toEqual({ decision: "create", attempts: 0 });
    expect(claims).toBe(0);
  });

  test("retries after the DO rejects a stale joinability race", async () => {
    const candidates = [room("residual", 3), room("lobby", 2)];
    const reconciled: string[] = [];
    const result = await runQuickPlayMatchmaking(NOW, {
      select: async () => candidates,
      claim: async () => true,
      join: async (candidate) => candidate.roomId === "residual"
        ? { status: "ineligible" as const }
        : { status: "ok" as const, value: "joined" },
      reconcile: async (candidate, outcome) => { reconciled.push(`${candidate.roomId}:${outcome}`); },
    });
    expect(result).toMatchObject({ decision: "joined", candidate: { roomId: "lobby" }, attempts: 2 });
    expect(reconciled).toEqual(["residual:ineligible"]);
  });

  test("absorbs lost claims and DO full/ended races before creating", async () => {
    const candidates = [room("a", 3), room("b", 2), room("c", 1), room("d", 0)];
    const claims = [false, true, true];
    const joins: QuickPlayJoinOutcome<string>[] = [{ status: "full" }, { status: "ended" }];
    const reconciled: string[] = [];
    const result = await runQuickPlayMatchmaking(NOW, {
      select: async () => candidates,
      claim: async () => claims.shift() ?? false,
      join: async () => joins.shift() ?? { status: "not_found" },
      reconcile: async (candidate, outcome) => { reconciled.push(`${candidate.roomId}:${outcome}`); },
    });
    expect(result).toEqual({ decision: "create", attempts: QUICKPLAY_MAX_ATTEMPTS });
    expect(reconciled).toEqual(["b:full", "c:ended"]);
  });

  test("lets only one concurrent caller claim the final seat", async () => {
    const candidate = room("only-seat", 3);
    let seatAvailable = true;
    const run = () => runQuickPlayMatchmaking(NOW, {
      select: async () => [candidate],
      claim: async () => {
        if (!seatAvailable) return false;
        seatAvailable = false;
        return true;
      },
      join: async () => ({ status: "ok" as const, value: "joined" }),
      reconcile: async () => {},
    });
    const [first, second] = await Promise.all([run(), run()]);
    expect([first.decision, second.decision].sort()).toEqual(["create", "joined"]);
  });
});
