import { describe, expect, test } from "bun:test";
import { ROOM_HEARTBEAT_INTERVAL_MS } from "./quickplay";
import { TIMER_CANCEL_GRACE_MS } from "./room-core";
import {
  EMPTY_ROOM_TTL_MS,
  nextRoomAlarmAt,
  planCanonicalTimerAlarm,
  planRoomAlarm,
} from "./room-liveness";

describe("room alarm multiplexing", () => {
  test("refreshes connected rooms on the coarse heartbeat cadence", () => {
    const now = 100_000;
    expect(planRoomAlarm(now, {
      connectionCount: 2, lastHeartbeatAt: now - ROOM_HEARTBEAT_INTERVAL_MS, emptySinceAt: null,
    })).toEqual({ heartbeatDue: true, expiryDue: false, nextAlarmAt: now + ROOM_HEARTBEAT_INTERVAL_MS });
  });

  test("keeps the empty-room TTL and expires only when due", () => {
    const emptySinceAt = 10;
    expect(planRoomAlarm(emptySinceAt + EMPTY_ROOM_TTL_MS - 1, {
      connectionCount: 0, lastHeartbeatAt: null, emptySinceAt,
    })).toMatchObject({ heartbeatDue: false, expiryDue: false, nextAlarmAt: emptySinceAt + EMPTY_ROOM_TTL_MS });
    expect(planRoomAlarm(emptySinceAt + EMPTY_ROOM_TTL_MS, {
      connectionCount: 0, lastHeartbeatAt: null, emptySinceAt,
    })).toEqual({ heartbeatDue: false, expiryDue: true, nextAlarmAt: null });
  });

  test("selects the earliest canonical timer but pauses it for an empty room", () => {
    expect(nextRoomAlarmAt(10_000, 5_000, 2)).toBe(5_000);
    expect(nextRoomAlarmAt(10_000, 5_000, 0)).toBe(10_000);
    expect(nextRoomAlarmAt(null, 5_000, 1)).toBe(5_000);
  });

  test("defers a due timer once when an action was just sequenced, then fires it", () => {
    expect(TIMER_CANCEL_GRACE_MS).toBeGreaterThanOrEqual(250);
    expect(TIMER_CANCEL_GRACE_MS).toBeLessThanOrEqual(400);
    const actionAt = 10_000;
    const dueAt = actionAt + 10;
    expect(planCanonicalTimerAlarm(dueAt, {
      status: "scheduled",
      dueAt,
      deferredOnce: false,
      lastActionAt: actionAt,
    })).toEqual({ type: "defer", nextAttemptAt: dueAt + TIMER_CANCEL_GRACE_MS });
    expect(planCanonicalTimerAlarm(dueAt + TIMER_CANCEL_GRACE_MS, {
      status: "scheduled",
      dueAt: dueAt + TIMER_CANCEL_GRACE_MS,
      deferredOnce: true,
      lastActionAt: dueAt + TIMER_CANCEL_GRACE_MS - 1,
    })).toEqual({ type: "fire" });
  });

  test("skips a timer when its cancel report lands during the grace window", () => {
    expect(planCanonicalTimerAlarm(1_000, {
      status: "canceled",
      dueAt: 900,
      deferredOnce: true,
      lastActionAt: 800,
    })).toEqual({ type: "skip" });
  });
});
