import { ROOM_HEARTBEAT_INTERVAL_MS } from "./quickplay";

export const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;

export interface RoomAlarmState {
  connectionCount: number;
  lastHeartbeatAt: number | null;
  emptySinceAt: number | null;
}

export interface RoomAlarmPlan {
  heartbeatDue: boolean;
  expiryDue: boolean;
  nextAlarmAt: number | null;
}

export function planRoomAlarm(now: number, state: RoomAlarmState): RoomAlarmPlan {
  if (state.connectionCount > 0) {
    const heartbeatDue = state.lastHeartbeatAt === null ||
      now - state.lastHeartbeatAt >= ROOM_HEARTBEAT_INTERVAL_MS;
    return {
      heartbeatDue,
      expiryDue: false,
      nextAlarmAt: now + ROOM_HEARTBEAT_INTERVAL_MS,
    };
  }
  const emptySinceAt = state.emptySinceAt ?? now;
  const expiryAt = emptySinceAt + EMPTY_ROOM_TTL_MS;
  return {
    heartbeatDue: false,
    expiryDue: now >= expiryAt,
    nextAlarmAt: now >= expiryAt ? null : expiryAt,
  };
}
