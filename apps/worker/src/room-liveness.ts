import { ROOM_HEARTBEAT_INTERVAL_MS } from "./quickplay";
import { TIMER_CANCEL_GRACE_MS } from "./room-core";

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

export interface CanonicalTimerAlarmState {
  status: "scheduled" | "fired" | "canceled";
  dueAt: number;
  deferredOnce: boolean;
  lastActionAt: number | null;
}

export type CanonicalTimerAlarmPlan =
  | { type: "skip" }
  | { type: "wait" }
  | { type: "defer"; nextAttemptAt: number }
  | { type: "fire" };

/** Pure per-row plan used after the alarm transaction re-reads timer status. */
export function planCanonicalTimerAlarm(
  now: number,
  state: CanonicalTimerAlarmState,
): CanonicalTimerAlarmPlan {
  if (state.status !== "scheduled") return { type: "skip" };
  if (state.dueAt > now) return { type: "wait" };
  const actionAge = state.lastActionAt === null ? null : now - state.lastActionAt;
  if (
    !state.deferredOnce &&
    actionAge !== null &&
    actionAge >= 0 &&
    actionAge < TIMER_CANCEL_GRACE_MS
  ) {
    return { type: "defer", nextAttemptAt: now + TIMER_CANCEL_GRACE_MS };
  }
  return { type: "fire" };
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

/** Multiplex the single DO alarm; canonical game timers pause while empty. */
export function nextRoomAlarmAt(
  livenessAt: number | null,
  earliestTimerDueAt: number | null,
  connectionCount: number,
): number | null {
  const timerAt = connectionCount > 0 ? earliestTimerDueAt : null;
  if (livenessAt === null) return timerAt;
  if (timerAt === null) return livenessAt;
  return Math.min(livenessAt, timerAt);
}
