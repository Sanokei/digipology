import { describe, expect, test } from "bun:test";
import { ROOM_HEARTBEAT_INTERVAL_MS } from "./quickplay";
import { EMPTY_ROOM_TTL_MS, nextRoomAlarmAt, planRoomAlarm } from "./room-liveness";

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
});
