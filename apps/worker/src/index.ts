import { DurableObject } from "cloudflare:workers";
import {
  PROTOCOL_VERSION,
  type ActionRequest,
  type OrderedAction,
  type PlayerInfo,
  type RoomEndedMessage,
  type ServerMessage,
} from "digipology-protocol";
import {
  loadSnapshot,
  snapshot,
  snapshotRequiresScripts,
  type GameSnapshot,
} from "digipology-kernel";
import type { CheckpointAttestationRequest, GameSnapshotDto, ReleaseBundleDto } from "digipology-protocol/http";
import { hashSelector, sha256Hex, timingSafeHashEqual } from "./crypto";
import {
  handleTextFrame,
  sendServerMessage,
  type ConnectionState,
} from "./message-handler";
import { handlePlatformRequest } from "./platform";
import { generatePlayerId, generateSessionToken } from "./random";
import { createBuiltinInitialState } from "./initial-state";
import {
  ACTION_RETENTION,
  attestCheckpointCandidate,
  bootstrapPlan,
  checkpointBaseConnects,
  checkpointIsDue,
  CHECKPOINT_INTERVAL,
  replayCheckpoint,
  resumeBaseFromSave,
  retentionFloor,
  RoomCore,
  roomBootstrapFromSnapshots,
  ScriptedBootstrapUnavailableError,
  TIMER_CANCEL_GRACE_MS,
  timerFireDedupKey,
  nextHost,
  savedPlayerIdsToRemove,
  scheduledTimersToArm,
  validateCheckpointAttestationSnapshot,
  type RoomCoreState,
} from "./room-core";
import {
  nextRoomAlarmAt,
  planCanonicalTimerAlarm,
  planRoomAlarm,
} from "./room-liveness";

const DEFAULT_ROOM_CAPACITY = 8;
const DUMMY_HASH = "0".repeat(64);

interface RoomMetadataRow extends Record<string, SqlStorageValue> {
  room_id: string;
  join_code: string;
  release_id: string;
  capacity: number;
  ended_reason: "host_ended" | "expired" | "moderation" | null;
  last_sequence: number;
  started: number;
  initial_snapshot: string | null;
  checkpoint_snapshot: string | null;
  checkpoint_sequence: number | null;
  checkpoint_attested: number;
  scripted: number | null;
  quickplay_joinable: number;
  last_heartbeat_at: number | null;
  empty_since_at: number | null;
  last_action_at: number | null;
  last_multi_bootstrap_at: number | null;
  bootstrap_unavailable_logged_at: number | null;
  host_player_id: string | null;
  creator_user_id: string | null;
  resumed: number;
}

interface PlayerRow extends Record<string, SqlStorageValue> {
  player_id: string;
  display_name: string;
  user_id: string | null;
}

interface PlayerTokenRow extends Record<string, SqlStorageValue> {
  player_id: string;
  token_hash: string;
}

interface ActionRow extends Record<string, SqlStorageValue> {
  body: string;
}

interface TimerMetadataRow extends Record<string, SqlStorageValue> {
  timer_id: string;
  due_at: number;
  status: "scheduled" | "fired" | "canceled";
  deferred_once: number;
}

interface CheckpointCandidateRow extends Record<string, SqlStorageValue> {
  sequence: number;
  state_hash: string;
  snapshot_json: string;
  conflicted: number;
}

export type CheckpointAttestationStatus =
  | "accepted"
  | "confirmed"
  | "duplicate"
  | "divergent"
  | "conflicted"
  | "unauthorized"
  | "rate_limited"
  | "rejected";

export interface CheckpointAttestationOutcome {
  status: CheckpointAttestationStatus;
  reason?: string;
}

const CHECKPOINT_ATTESTATION_RATE_LIMIT = 12;
const CHECKPOINT_ATTESTATION_RATE_WINDOW_MS = 60_000;
const BOOTSTRAP_UNAVAILABLE_LOG_INTERVAL_MS = 5 * 60_000;
const BOOTSTRAP_UNAVAILABLE_MESSAGE =
  "This table needs a checkpoint from a player who is already seated before new players can join. Ask them to keep playing, then try again.";

type SocketAttachment = ConnectionState;

/**
 * A socket counts for checkpoint quorum only once hello produced a bootstrap or
 * resume. Attachments serialized before the `bootstrapped` flag existed (sockets
 * hibernated across a deploy) carry no flag; an authenticated legacy attachment
 * could only have got there through a completed hello, so it counts rather than
 * silently disabling attestation for that player until they reconnect.
 */
function isBootstrappedAttachment(
  state: SocketAttachment | null,
): state is SocketAttachment & { playerId: string } {
  return state?.authenticated === true && state.playerId !== null && state.bootstrapped !== false;
}

type JoinResult =
  | {
      status: "ok";
      playerId: string;
      roomToken: string;
      releaseId: string;
      playerCount: number;
    }
  | { status: "not_found" }
  | { status: "full" }
  | { status: "ended" }
  | { status: "ineligible" };

export type SaveSnapshotOutcome =
  | { status: "ok"; snapshotJson: string; releaseId: string; sequence: number; stateHash: string }
  | { status: "unauthorized" }
  | { status: "host_only" }
  | { status: "unavailable" }
  | { status: "stale" }
  | { status: "invalid"; reason?: string };

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  init(
    roomId: string,
    joinCode: string,
    releaseId: string,
    capacity = DEFAULT_ROOM_CAPACITY,
    creatorUserId: string | null = null,
  ): boolean {
    if (this.room() !== null) return false;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) return false;
    this.ctx.storage.transactionSync(() => {
      this.createSchema();
      this.ctx.storage.sql.exec(
        `INSERT INTO room
          (singleton, room_id, join_code, release_id, capacity, ended_reason,
           last_sequence, quickplay_joinable, creator_user_id, resumed)
         VALUES (1, ?, ?, ?, ?, NULL, 0, 1, ?, 0)`,
        roomId,
        joinCode,
        releaseId,
        capacity,
        creatorUserId,
      );
    });
    return true;
  }

  initFromSave(
    roomId: string,
    joinCode: string,
    releaseId: string,
    capacity: number,
    savedSnapshotDto: GameSnapshotDto,
    creatorUserId: string | null = null,
  ): boolean {
    if (this.room() !== null || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) return false;
    let base: GameSnapshot;
    try {
      base = resumeBaseFromSave(savedSnapshotDto as GameSnapshot);
    } catch {
      return false;
    }
    if (base.releaseId !== releaseId) return false;
    this.ctx.storage.transactionSync(() => {
      this.createSchema();
      this.ctx.storage.sql.exec(
        `INSERT INTO room
          (singleton, room_id, join_code, release_id, capacity, ended_reason,
           last_sequence, quickplay_joinable, initial_snapshot, scripted,
           creator_user_id, resumed)
         VALUES (1, ?, ?, ?, ?, NULL, 0, 1, ?, ?, ?, 1)`,
        roomId, joinCode, releaseId, capacity, JSON.stringify(base),
        snapshotRequiresScripts(base) ? 1 : 0, creatorUserId,
      );
    });
    return true;
  }

  async join(displayName: string, requireQuickPlayJoinable = false, userId: string | null = null): Promise<JoinResult> {
    const playerId = generatePlayerId();
    const roomToken = generateSessionToken();
    const tokenHash = await sha256Hex(roomToken);
    const tokenSelector = hashSelector(tokenHash);
    const orderedActions: OrderedAction[] = [];
    const result = this.ctx.storage.transactionSync((): JoinResult => {
      const room = this.room();
      if (room === null) return { status: "not_found" };
      if (room.ended_reason !== null) return { status: "ended" };
      if (requireQuickPlayJoinable && room.quickplay_joinable !== 1) {
        return { status: "ineligible" };
      }
      const count = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM players",
      ).one().count;
      if (count >= room.capacity) return { status: "full" };
      this.ctx.storage.sql.exec(
        `INSERT INTO players
          (player_id, display_name, token_selector, token_hash, user_id)
         VALUES (?, ?, ?, ?, ?)`,
        playerId,
        normalizeDisplayName(displayName),
        tokenSelector,
        tokenHash,
        userId,
      );
      if (room.host_player_id === null) {
        this.ctx.storage.sql.exec("UPDATE room SET host_player_id = ? WHERE singleton = 1", playerId);
      }
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO active_players (player_id) VALUES (?)",
        playerId,
      );
      if (room.started === 1) {
        const core = this.loadCore(room);
        orderedActions.push(core.sequenceSystem(
          {
            type: "system.player_joined",
            payload: { playerId, name: normalizeDisplayName(displayName) },
          },
          `player_joined_${playerId}`,
        ).orderedAction);
        orderedActions.push(core.sequenceSystem(
          {
            type: "system.seat_assign",
            payload: { playerId, seatId: `seat_${count + 1}` },
          },
          `seat_assign_${playerId}`,
        ).orderedAction);
        for (const ordered of orderedActions) this.persistSystemAction(ordered);
        this.advanceCheckpointIfNeeded(room, core);
        this.ctx.storage.sql.exec(
          "UPDATE room SET last_sequence = ? WHERE singleton = 1",
          core.state.lastSequence,
        );
      }
      return {
        status: "ok",
        playerId,
        roomToken,
        releaseId: room.release_id,
        playerCount: this.ctx.storage.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM active_players",
        ).one().count,
      };
    });
    if (result.status === "ok") {
      for (const ordered of orderedActions) this.broadcast(ordered);
      this.scheduleIndexMetadataUpdate();
    }
    return result;
  }

  hostPlayerId(): string | null { return this.room()?.host_player_id ?? null; }

  async endWithToken(roomToken: string): Promise<"ended" | "unauthorized" | "host_only" | "unavailable"> {
    const playerId = await this.authenticateRoomToken(roomToken);
    if (playerId === null) return "unauthorized";
    const room = this.requiredRoom();
    if (room.host_player_id !== playerId) return "host_only";
    return await this.end("host_ended") ? "ended" : "unavailable";
  }

  async saveSnapshot(roomToken: string, clientSnapshotDto?: GameSnapshotDto): Promise<SaveSnapshotOutcome> {
    const clientSnapshot = clientSnapshotDto as GameSnapshot | undefined;
    const playerId = await this.authenticateRoomToken(roomToken);
    if (playerId === null) return { status: "unauthorized" };
    const room = this.requiredRoom();
    if (room.host_player_id !== playerId) return { status: "host_only" };
    if (room.started !== 1 || room.ended_reason !== null || room.initial_snapshot === null) {
      return { status: "unavailable" };
    }
    const core = this.loadCore(room);
    if (!this.roomIsScripted(room)) {
      try {
        const base = this.storedCheckpoint(room) ?? this.requiredInitialSnapshot(room);
        const computed = replayCheckpoint(base, core.state.actions);
        return computed.sequence === room.last_sequence
          ? { status: "ok", snapshotJson: JSON.stringify(computed), releaseId: computed.releaseId,
              sequence: computed.sequence, stateHash: computed.stateHash }
          : { status: "invalid", reason: "Mechanical save replay did not reach the room sequence" };
      } catch (error) {
        return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
      }
    }
    const attested = this.storedCheckpoint(room, true);
    const candidate = attested?.sequence === room.last_sequence ? attested : clientSnapshot;
    if (candidate === undefined) return { status: "stale" };
    if (candidate.sequence !== room.last_sequence) return { status: "stale" };
    try {
      loadSnapshot(candidate);
      if (candidate.releaseId !== room.release_id) return { status: "invalid", reason: "Snapshot release does not match the room" };
      if (attested?.sequence === room.last_sequence && attested.stateHash !== candidate.stateHash) {
        return { status: "invalid", reason: "Snapshot hash conflicts with the attested checkpoint" };
      }
      return { status: "ok", snapshotJson: JSON.stringify(candidate), releaseId: candidate.releaseId,
        sequence: candidate.sequence, stateHash: candidate.stateHash };
    } catch (error) {
      return { status: "invalid", reason: error instanceof Error ? error.message : "Snapshot integrity check failed" };
    }
  }

  async end(reason: "host_ended" | "expired" | "moderation" = "host_ended"): Promise<boolean> {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return false;
    this.ctx.storage.sql.exec(
      "UPDATE room SET ended_reason = ?, quickplay_joinable = 0 WHERE singleton = 1",
      reason,
    );
    const message: RoomEndedMessage = { type: "room_ended", protocolVersion: PROTOCOL_VERSION, reason };
    for (const socket of this.ctx.getWebSockets()) {
      sendServerMessage(socket, message);
      socket.close(1000, "Room ended");
    }
    this.ctx.waitUntil(this.flushPlayCounts());
    try {
      await this.env.DB.prepare(
        "UPDATE rooms_index SET ended_at = ?, player_count = 0, joinable = 0 WHERE room_id = ?",
      ).bind(Date.now(), room.room_id).run();
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "room discovery cache end update failed",
        roomId: room.room_id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return true;
  }

  /**
   * Store canonical timer metadata only. Lua remains entirely client-side.
   * Every scripted client reports the same timer id with its own wall-clock
   * delay, so a repeat registration is accepted and the first writer wins.
   */
  async registerCanonicalTimer(timerId: string, dueAt: number): Promise<boolean> {
    if (typeof timerId !== "string" || timerId.length === 0 || timerId.length > 256 ||
      !Number.isSafeInteger(dueAt) || dueAt < 0) return false;
    if (this.room() === null) return false;
    // `rowsWritten` is not a reliable "inserted" signal on the SQLite cursor, so
    // the alarm is always re-planned; it is idempotent over the scheduled set.
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO canonical_timers (timer_id, due_at, status, deferred_once)
       VALUES (?, ?, 'scheduled', 0)`,
      timerId,
      dueAt,
    );
    await this.rescheduleAlarm(Date.now());
    return true;
  }

  /**
   * Cancel is idempotent over the timer's lifecycle: a timer that already fired
   * or was canceled by another client is reported as accepted (it will not fire
   * again either way). Only an unknown timer id is rejected.
   */
  async cancelCanonicalTimer(timerId: string): Promise<boolean> {
    if (typeof timerId !== "string" || timerId.length === 0 || this.room() === null) return false;
    this.ctx.storage.sql.exec(
      "UPDATE canonical_timers SET status = 'canceled' WHERE timer_id = ? AND status = 'scheduled'",
      timerId,
    );
    const known = this.ctx.storage.sql.exec<TimerMetadataRow>(
      "SELECT timer_id, due_at, status, deferred_once FROM canonical_timers WHERE timer_id = ?",
      timerId,
    ).toArray().length === 1;
    if (known) await this.rescheduleAlarm(Date.now());
    return known;
  }

  async scheduleCanonicalTimer(
    roomToken: string,
    timerId: string,
    delaySeconds: number,
  ): Promise<boolean> {
    if (await this.authenticateRoomToken(roomToken) === null ||
      typeof delaySeconds !== "number" || !Number.isFinite(delaySeconds) ||
      delaySeconds <= 0 || delaySeconds > 86_400) return false;
    const delayMs = Math.max(1, Math.ceil(delaySeconds * 1_000));
    return this.registerCanonicalTimer(timerId, Date.now() + delayMs);
  }

  async cancelCanonicalTimerForPlayer(roomToken: string, timerId: string): Promise<boolean> {
    if (await this.authenticateRoomToken(roomToken) === null) return false;
    return this.cancelCanonicalTimer(timerId);
  }

  /** Validate and store a client-authored checkpoint without simulating rules. */
  async attestCheckpoint(
    roomToken: string,
    input: Omit<CheckpointAttestationRequest, "roomToken">,
  ): Promise<CheckpointAttestationOutcome> {
    const playerId = await this.authenticateRoomToken(roomToken);
    if (playerId === null) return { status: "unauthorized" };

    const room = this.requiredRoom();
    if (!this.roomIsScripted(room)) {
      return { status: "rejected", reason: "Room does not require scripted checkpoints" };
    }
    const bootstrappedPlayerIds = this.bootstrappedPlayerIds();
    if (!bootstrappedPlayerIds.includes(playerId)) {
      return { status: "rejected", reason: "Checkpoint attester is not connected" };
    }
    const now = Date.now();
    const lastMultiBootstrapAt = bootstrappedPlayerIds.length >= 2
      ? now
      : room.last_multi_bootstrap_at;
    if (bootstrappedPlayerIds.length >= 2) this.recordMultiBootstrapPresence(now);
    const candidateSnapshot = input.snapshot as unknown as GameSnapshot;
    const core = this.loadCore(room);
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0 ||
      input.sequence % CHECKPOINT_INTERVAL !== 0 ||
      !checkpointBaseConnects(input.sequence, core.state)) {
      return { status: "rejected", reason: "Checkpoint sequence is outside the attestation window" };
    }
    if (room.checkpoint_sequence !== null && input.sequence <= room.checkpoint_sequence) {
      return { status: "duplicate" };
    }
    if (!this.consumeCheckpointAttestationRate(playerId, now)) {
      return { status: "rate_limited" };
    }
    try {
      validateCheckpointAttestationSnapshot(
        { sequence: input.sequence, stateHash: input.stateHash, snapshot: candidateSnapshot },
        room.release_id,
        core.state,
      );
    } catch (error) {
      return {
        status: "rejected",
        reason: error instanceof Error ? error.message : "Checkpoint was not accepted",
      };
    }
    const snapshotJson = JSON.stringify(candidateSnapshot);
    const result = this.ctx.storage.transactionSync(() => {
      const floor = retentionFloor(core.state);
      this.ctx.storage.sql.exec(
        "DELETE FROM checkpoint_attesters WHERE sequence < ?",
        floor,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM checkpoint_candidates WHERE sequence < ?",
        floor,
      );
      const row = this.ctx.storage.sql.exec<CheckpointCandidateRow>(
        `SELECT sequence, state_hash, snapshot_json, conflicted
         FROM checkpoint_candidates WHERE sequence = ?`,
        input.sequence,
      ).toArray()[0];
      const attesters = row === undefined ? [] : this.ctx.storage.sql.exec<{ player_id: string }>(
        "SELECT player_id FROM checkpoint_attesters WHERE sequence = ? ORDER BY player_id",
        input.sequence,
      ).toArray().map((item) => item.player_id);
      const recorded = attestCheckpointCandidate(
        row === undefined ? null : {
          sequence: row.sequence,
          stateHash: row.state_hash,
          snapshotJson: row.snapshot_json,
          attesters: new Set(attesters),
          conflicted: row.conflicted === 1,
        },
        { sequence: input.sequence, stateHash: input.stateHash, snapshotJson, playerId },
        bootstrappedPlayerIds,
        { now, lastMultiBootstrapAt },
      );
      if (recorded.status !== "conflicted") {
        this.ctx.storage.sql.exec(
          `INSERT INTO checkpoint_candidates (sequence, state_hash, snapshot_json, conflicted)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(sequence) DO UPDATE SET conflicted = excluded.conflicted`,
          recorded.candidate.sequence,
          recorded.candidate.stateHash,
          recorded.candidate.snapshotJson,
          recorded.candidate.conflicted ? 1 : 0,
        );
      }
      if (recorded.status !== "divergent" && recorded.status !== "conflicted") {
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO checkpoint_attesters (sequence, player_id) VALUES (?, ?)",
          input.sequence,
          playerId,
        );
      }
      if (recorded.status === "confirmed") {
        this.ctx.storage.sql.exec(
          `UPDATE room SET checkpoint_snapshot = ?, checkpoint_sequence = ?, checkpoint_attested = 1
           WHERE singleton = 1 AND (checkpoint_sequence IS NULL OR checkpoint_sequence < ?)`,
          recorded.candidate.snapshotJson,
          recorded.candidate.sequence,
          recorded.candidate.sequence,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM actions WHERE sequence <= ?",
          Math.max(0, recorded.candidate.sequence - ACTION_RETENTION),
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM checkpoint_attesters WHERE sequence <= ?",
          recorded.candidate.sequence,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM checkpoint_candidates WHERE sequence <= ?",
          recorded.candidate.sequence,
        );
      }
      return recorded;
    });

    if (result.status === "divergent") {
      if (result.candidate.stateHash === input.stateHash) {
        throw new Error("Divergent checkpoint result requires different hashes");
      }
      console.warn(JSON.stringify({
        level: "warn",
        message: "scripted checkpoint hash divergence",
        roomId: room.room_id,
        sequence: input.sequence,
        candidateHash: result.candidate.stateHash,
        submittedHash: input.stateHash,
        playerId,
      }));
      return { status: "divergent", reason: "Checkpoint hash diverges from another client" };
    }
    if (result.status === "conflicted") return { status: "conflicted" };
    return { status: result.status === "recorded" ? "accepted" : result.status };
  }

  async fetch(request: Request): Promise<Response> {
    if (this.room() === null) {
      return Response.json(
        { error: { code: "not_found", message: "Room not found" } },
        { status: 404 },
      );
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { error: { code: "websocket_required", message: "Expected WebSocket upgrade" } },
        { status: 426 },
      );
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      authenticated: false,
      playerId: null,
      bootstrapped: false,
    } satisfies SocketAttachment);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE room SET empty_since_at = NULL, last_heartbeat_at = ? WHERE singleton = 1",
      now,
    );
    await this.rescheduleAlarm(now);
    this.scheduleIndexMetadataUpdate();
    this.ctx.waitUntil(this.flushPlayCounts());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer): Promise<void> {
    if (typeof frame !== "string") {
      await handleTextFrame(socket, "", this.messageContext(socket));
      return;
    }
    const context = this.messageContext(socket);
    await handleTextFrame(socket, frame, context);
    socket.serializeAttachment(context.state);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.handleSocketDeparture(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.handleSocketDeparture(socket);
  }

  async alarm(): Promise<void> {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return;
    const now = Date.now();
    const timerActions: OrderedAction[] = [];
    let deferredTimerCount = 0;
    if (this.ctx.getWebSockets().length > 0) {
      this.ctx.storage.transactionSync(() => {
        const current = this.requiredRoom();
        const core = this.loadCore(current);
        const due = this.ctx.storage.sql.exec<TimerMetadataRow>(
          `SELECT timer_id, due_at, status, deferred_once FROM canonical_timers
           WHERE status = 'scheduled' AND due_at <= ?
           ORDER BY due_at, timer_id`,
          now,
        ).toArray();
        for (const timer of due) {
          // A cancel report can land after the alarm was armed. Re-read the row
          // at the last possible point inside this transaction before sequencing.
          const latest = this.ctx.storage.sql.exec<TimerMetadataRow>(
            `SELECT timer_id, due_at, status, deferred_once
             FROM canonical_timers WHERE timer_id = ?`,
            timer.timer_id,
          ).toArray()[0];
          if (latest === undefined) continue;
          const plan = planCanonicalTimerAlarm(now, {
            status: latest.status,
            dueAt: latest.due_at,
            deferredOnce: latest.deferred_once === 1,
            lastActionAt: current.last_action_at,
          });
          if (plan.type === "defer") {
            this.ctx.storage.sql.exec(
              `UPDATE canonical_timers SET due_at = ?, deferred_once = 1
               WHERE timer_id = ? AND status = 'scheduled' AND deferred_once = 0`,
              plan.nextAttemptAt,
              timer.timer_id,
            );
            deferredTimerCount += 1;
            continue;
          }
          if (plan.type !== "fire") continue;
          const sequenced = core.sequenceSystem(
            { type: "system.timer_fire", payload: { timerId: timer.timer_id } },
            timerFireDedupKey(timer.timer_id),
          );
          if (!sequenced.duplicate) {
            this.persistSystemAction(sequenced.orderedAction);
            this.ctx.storage.sql.exec(
              "UPDATE canonical_timers SET status = 'fired' WHERE timer_id = ? AND status = 'scheduled'",
              timer.timer_id,
            );
            timerActions.push(sequenced.orderedAction);
          }
        }
        if (timerActions.length > 0) {
          this.advanceCheckpointIfNeeded(current, core);
          this.ctx.storage.sql.exec(
            "UPDATE room SET last_sequence = ? WHERE singleton = 1",
            core.state.lastSequence,
          );
        }
      });
    }
    if (deferredTimerCount > 0) {
      console.log(JSON.stringify({
        level: "info",
        message: "canonical timer fires deferred for cancel grace",
        roomId: room.room_id,
        deferralCount: deferredTimerCount,
        graceMs: TIMER_CANCEL_GRACE_MS,
      }));
    }
    for (const action of timerActions) this.broadcast(action);
    const plan = planRoomAlarm(now, {
      connectionCount: this.ctx.getWebSockets().length,
      lastHeartbeatAt: room.last_heartbeat_at,
      emptySinceAt: room.empty_since_at,
    });
    if (plan.expiryDue) {
      await this.end("expired");
      return;
    }
    if (plan.heartbeatDue) {
      this.ctx.storage.sql.exec(
        "UPDATE room SET last_heartbeat_at = ? WHERE singleton = 1",
        now,
      );
      await this.writeIndexMetadata();
    }
    await this.flushPlayCounts();
    await this.rescheduleAlarm(now);
  }

  private messageContext(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const state: SocketAttachment = attachment ?? {
      authenticated: false,
      playerId: null,
      bootstrapped: false,
    };
    return {
      state,
      authenticate: (token: string): Promise<string | null> => this.authenticateRoomToken(token),
      hello: async (
        _playerId: string,
        lastSequence: number | null,
      ): Promise<ServerMessage | readonly ServerMessage[]> => {
        socket.serializeAttachment(state);
        const before = this.requiredRoom();
        if (
          before.ended_reason === null &&
          before.started === 0 &&
          before.last_sequence !== 0
        ) {
          await this.expireLegacyRoom();
        }
        const afterLegacyCheck = this.requiredRoom();
        if (afterLegacyCheck.ended_reason !== null) {
          return {
            type: "room_ended",
            protocolVersion: PROTOCOL_VERSION,
            reason: afterLegacyCheck.ended_reason,
          };
        }
        await this.startIfNeeded();
        const room = this.requiredRoom();
        if (room.ended_reason !== null) {
          return { type: "room_ended", protocolVersion: PROTOCOL_VERSION, reason: room.ended_reason };
        }
        if (lastSequence === null) {
          const initialSnapshot = this.requiredInitialSnapshot(room);
          const core = this.loadCore(room);
          const scripted = this.roomIsScripted(room);
          const needsRecoveryBase = core.resumeAfter(initialSnapshot.sequence).type === "resync_required";
          const checkpoint = needsRecoveryBase
            ? this.storedCheckpoint(room, scripted)
            : null;
          const plan = bootstrapPlan({
            initialSequence: initialSnapshot.sequence,
            needsRecoveryBase,
            scripted,
            checkpointSequence: checkpoint?.sequence ?? null,
          });
          if (plan.type === "initial-tail") {
            return roomBootstrapFromSnapshots(core, initialSnapshot, null, this.players());
          }
          if (!scripted) {
            return roomBootstrapFromSnapshots(core, initialSnapshot, checkpoint, this.players());
          }
          const actions = this.loadActionsAfter(plan.baseSequence);
          if (plan.type === "full-log") {
            const storedCharacters = this.ctx.storage.sql.exec<{ size: number }>(
              "SELECT COALESCE(SUM(LENGTH(body)), 0) AS size FROM actions WHERE sequence > ?",
              plan.baseSequence,
            ).one().size;
            console.info(JSON.stringify({
              level: "info",
              message: "scripted checkpoint bootstrap using full action log",
              roomId: room.room_id,
              actionCount: actions.length,
              storedCharacters,
            }));
          }
          try {
            return roomBootstrapFromSnapshots(
              core,
              initialSnapshot,
              checkpoint,
              this.players(),
              { scripted: true, fullActions: actions },
            );
          } catch (error) {
            if (!(error instanceof ScriptedBootstrapUnavailableError)) throw error;
            this.logBootstrapUnavailable(room, core);
            return {
              type: "protocol_error",
              protocolVersion: PROTOCOL_VERSION,
              code: "bootstrap_unavailable",
              message: BOOTSTRAP_UNAVAILABLE_MESSAGE,
            };
          }
        }
        const result = this.loadCore(room).resumeAfter(lastSequence);
        if (result.type === "resume") return result.message;
        if (result.type === "resync_required") {
          return { type: "resync_required", protocolVersion: PROTOCOL_VERSION };
        }
        return {
          type: "protocol_error",
          protocolVersion: PROTOCOL_VERSION,
          code: "malformed_message",
          message: "lastSequence is ahead of the room sequence",
        };
      },
      afterHelloSent: async (
        playerId: string,
        messages: readonly ServerMessage[],
      ): Promise<void> => {
        if (!messages.some((message) => message.type === "bootstrap" || message.type === "resume")) return;
        state.bootstrapped = true;
        socket.serializeAttachment(state);
        this.recordMultiBootstrapPresence(Date.now());
        this.markPlayerActive(playerId);
        this.recordFirstBootstrap(playerId);
      },
      sequence: (playerId: string, request: ActionRequest) => this.sequence(playerId, request),
      broadcast: (message: ServerMessage): void => {
        this.broadcast(message);
      },
    };
  }

  private async authenticateRoomToken(token: string): Promise<string | null> {
    const room = this.room();
    if (room === null) return null;
    const tokenHash = await sha256Hex(token);
    const candidates = this.ctx.storage.sql.exec<PlayerTokenRow>(
      "SELECT player_id, token_hash FROM players WHERE token_selector = ?",
      hashSelector(tokenHash),
    ).toArray();
    if (candidates.length === 0) await timingSafeHashEqual(tokenHash, DUMMY_HASH);
    let playerId: string | null = null;
    for (const candidate of candidates) {
      const equal = await timingSafeHashEqual(tokenHash, candidate.token_hash);
      if (equal && playerId === null) playerId = candidate.player_id;
    }
    return playerId;
  }

  private sequence(playerId: string, request: ActionRequest): { message: OrderedAction; duplicate: boolean } {
    const sequenced = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<ActionRow>(
        "SELECT body FROM request_dedup WHERE request_id = ?",
        request.requestId,
      ).toArray()[0];
      if (existing !== undefined) {
        return {
          message: JSON.parse(existing.body) as OrderedAction,
          duplicate: true,
          becameIneligible: false,
        };
      }

      const room = this.requiredRoom();
      const core = this.loadCore(room);
      const result = core.sequence(request, playerId);
      this.ctx.storage.sql.exec(
        `UPDATE room
         SET last_sequence = ?, quickplay_joinable = 0, last_action_at = ?
         WHERE singleton = 1`,
        result.orderedAction.sequence,
        Date.now(),
      );
      const body = JSON.stringify(result.orderedAction);
      this.ctx.storage.sql.exec(
        `INSERT INTO actions (sequence, action_id, request_id, body)
         VALUES (?, ?, ?, ?)`,
        result.orderedAction.sequence,
        result.orderedAction.actionId,
        request.requestId,
        body,
      );
      // This table is deliberately independent of replay-window trimming. A
      // retried request ID therefore keeps its one canonical sequence mapping.
      this.ctx.storage.sql.exec(
        "INSERT INTO request_dedup (request_id, action_id, sequence, body) VALUES (?, ?, ?, ?)",
        request.requestId,
        result.orderedAction.actionId,
        result.orderedAction.sequence,
        body,
      );
      this.trimActionsAfterPersistence(room, result.orderedAction.sequence);
      this.advanceCheckpointIfNeeded(room, core);
      return {
        message: result.orderedAction,
        duplicate: false,
        // The joinable index column only ever transitions once; pushing the
        // metadata on every action would cost one D1 write per gameplay
        // action for nothing.
        becameIneligible: room.quickplay_joinable === 1,
      };
    });
    if (sequenced.becameIneligible) this.scheduleIndexMetadataUpdate();
    return { message: sequenced.message, duplicate: sequenced.duplicate };
  }

  private async startIfNeeded(): Promise<void> {
    const before = this.requiredRoom();
    if (before.started === 1 || before.ended_reason !== null) return;
    if (before.last_sequence !== 0) {
      await this.expireLegacyRoom();
      return;
    }
    const roster = this.playerRows().map((player) => ({
      playerId: player.player_id,
      displayName: player.display_name,
    }));
    const resumed = before.resumed === 1;
    const builtinState = resumed ? null : createBuiltinInitialState(before.release_id, roster);
    const baseSnapshot = resumed
      ? this.requiredInitialSnapshot(before)
      : builtinState === null
        ? await this.uploadedInitialSnapshot(before.release_id)
        : snapshot(builtinState);
    const resumeState = resumed ? loadSnapshot(baseSnapshot) : null;
    const timersToArm = resumeState === null ? [] : scheduledTimersToArm(resumeState);
    this.ctx.storage.transactionSync(() => {
      const room = this.requiredRoom();
      if (room.started === 1 || room.ended_reason !== null) return;
      if (room.last_sequence !== 0) {
        this.ctx.storage.sql.exec(
          "UPDATE room SET ended_reason = 'expired', quickplay_joinable = 0 WHERE singleton = 1",
        );
        return;
      }
      if (baseSnapshot.releaseId !== room.release_id) throw new Error("Room release snapshot mismatch");
      if (baseSnapshot.sequence !== 0) throw new Error("Room initial snapshot must start at sequence 0");
      const initialState = loadSnapshot(baseSnapshot);
      const core = this.loadCore(room);
      if (!resumed) {
        const started = core.sequenceSystem(
          { type: "system.game_start", payload: { settings: initialState.settings } },
          "game_start",
        );
        this.persistSystemAction(started.orderedAction);
      } else {
        for (const playerId of savedPlayerIdsToRemove(initialState)) {
          const left = core.sequenceSystem(
            { type: "system.player_left", payload: { playerId } },
            `saved_player_left_${playerId}`,
          );
          this.persistSystemAction(left.orderedAction);
        }
      }
      if (builtinState === null || resumed) {
        for (let index = 0; index < roster.length; index += 1) {
          const player = roster[index]!;
          const joined = core.sequenceSystem(
            { type: "system.player_joined", payload: { playerId: player.playerId, name: player.displayName } },
            `player_joined_${player.playerId}`,
          );
          this.persistSystemAction(joined.orderedAction);
          const seated = core.sequenceSystem(
            { type: "system.seat_assign", payload: { playerId: player.playerId, seatId: `seat_${index + 1}` } },
            `seat_assign_${player.playerId}`,
          );
          this.persistSystemAction(seated.orderedAction);
        }
      }
      this.ctx.storage.sql.exec(
        `UPDATE room
         SET started = 1, initial_snapshot = ?, last_sequence = ?, scripted = ?
         WHERE singleton = 1`,
        JSON.stringify(baseSnapshot),
        core.state.lastSequence,
        snapshotRequiresScripts(baseSnapshot) ? 1 : 0,
      );
      const now = Date.now();
      for (const timer of timersToArm) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO canonical_timers (timer_id, due_at, status, deferred_once)
           VALUES (?, ?, 'scheduled', 0)`,
          timer.timerId,
          now + timer.delayMs,
        );
      }
    });
    if (timersToArm.length > 0) await this.rescheduleAlarm(Date.now());
  }

  private async uploadedInitialSnapshot(releaseId: string): Promise<GameSnapshot> {
    const bucket = Reflect.get(this.env, "RELEASES") as R2Bucket | undefined;
    if (bucket === undefined) throw new Error(`Unknown room release ${releaseId}`);
    const object = await bucket.get(`releases/${releaseId}.json`);
    if (object === null) throw new Error(`Unknown room release ${releaseId}`);
    const bundle = await object.json<ReleaseBundleDto>();
    if (bundle.releaseId !== releaseId) throw new Error("Stored release ID mismatch");
    const candidate = bundle.initialSnapshot as unknown as GameSnapshot;
    loadSnapshot(candidate);
    return candidate;
  }

  private requiredInitialSnapshot(room: RoomMetadataRow): GameSnapshot {
    if (room.initial_snapshot === null) throw new Error("Started room has no initial snapshot");
    const candidate = JSON.parse(room.initial_snapshot) as GameSnapshot;
    loadSnapshot(candidate);
    return candidate;
  }

  private storedCheckpoint(room: RoomMetadataRow, requireAttested = false): GameSnapshot | null {
    if (requireAttested && room.checkpoint_attested !== 1) return null;
    if (room.checkpoint_snapshot === null && room.checkpoint_sequence === null) return null;
    if (room.checkpoint_snapshot === null || room.checkpoint_sequence === null) {
      throw new Error("Room checkpoint metadata is incomplete");
    }
    const candidate = JSON.parse(room.checkpoint_snapshot) as GameSnapshot;
    loadSnapshot(candidate);
    if (candidate.sequence !== room.checkpoint_sequence) {
      throw new Error("Room checkpoint sequence does not match its snapshot");
    }
    return candidate;
  }

  private advanceCheckpointIfNeeded(room: RoomMetadataRow, core: RoomCore): void {
    if (this.roomIsScripted(room)) return;
    const baseSequence = room.checkpoint_sequence ?? 0;
    if (!checkpointIsDue(baseSequence, core.state.lastSequence)) return;
    const stored = this.storedCheckpoint(room);
    const base = stored ?? this.requiredInitialSnapshot(room);
    if (stored === null && !checkpointBaseConnects(base.sequence, core.state)) {
      // A room that predates the checkpoint columns can already have a
      // retention floor beyond its initial snapshot; no checkpoint can be
      // constructed for it any more. Leave it on pre-checkpoint behavior
      // instead of failing the gameplay action that tried to advance it.
      return;
    }
    const next = replayCheckpoint(base, core.state.actions);
    if (next.sequence !== core.state.lastSequence) {
      throw new Error("Checkpoint replay did not reach the room sequence");
    }
    this.ctx.storage.sql.exec(
      `UPDATE room SET checkpoint_snapshot = ?, checkpoint_sequence = ?, checkpoint_attested = 0
       WHERE singleton = 1`,
      JSON.stringify(next),
      next.sequence,
    );
  }

  private async expireLegacyRoom(): Promise<void> {
    const expired = this.ctx.storage.transactionSync(() => {
      const room = this.requiredRoom();
      if (
        room.ended_reason !== null ||
        room.started !== 0 ||
        room.last_sequence === 0
      ) {
        return null;
      }
      this.ctx.storage.sql.exec(
        "UPDATE room SET ended_reason = 'expired', quickplay_joinable = 0 WHERE singleton = 1",
      );
      return room;
    });
    if (expired === null) return;
    this.ctx.waitUntil(this.flushPlayCounts());
    try {
      await this.env.DB.prepare(
        "UPDATE rooms_index SET ended_at = ?, player_count = 0, joinable = 0 WHERE room_id = ?",
      ).bind(Date.now(), expired.room_id).run();
    } catch (error) {
      this.logMetadataFailure("legacy_expiry", expired.room_id, error);
    }
  }

  private persistSystemAction(ordered: OrderedAction): void {
    const body = JSON.stringify(ordered);
    this.ctx.storage.sql.exec(
      `INSERT INTO actions (sequence, action_id, request_id, body)
       VALUES (?, ?, ?, ?)`,
      ordered.sequence,
      ordered.actionId,
      `system:${ordered.actionId}`,
      body,
    );
    this.trimActionsAfterPersistence(this.requiredRoom(), ordered.sequence);
  }

  private trimActionsAfterPersistence(room: RoomMetadataRow, sequence: number): void {
    if (room.initial_snapshot === null || !this.roomIsScripted(room)) {
      this.ctx.storage.sql.exec(
        "DELETE FROM actions WHERE sequence <= ?",
        sequence - ACTION_RETENTION,
      );
    }
    this.ctx.storage.sql.exec(
      "UPDATE room SET last_action_at = ? WHERE singleton = 1",
      Date.now(),
    );
  }

  private broadcast(message: ServerMessage): void {
    for (const peer of this.ctx.getWebSockets()) {
      const peerState = peer.deserializeAttachment() as SocketAttachment | null;
      if (peerState?.authenticated === true) sendServerMessage(peer, message);
    }
  }

  private markPlayerActive(playerId: string): void {
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO active_players (player_id) VALUES (?)",
      playerId,
    );
    this.ctx.storage.sql.exec(
      "UPDATE room SET empty_since_at = NULL, last_heartbeat_at = ? WHERE singleton = 1",
      Date.now(),
    );
    this.scheduleIndexMetadataUpdate();
  }

  private async handleSocketDeparture(socket: WebSocket): Promise<void> {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return;
    const state = socket.deserializeAttachment() as SocketAttachment | null;
    const peers = this.ctx.getWebSockets().filter((peer) => peer !== socket);
    const now = Date.now();
    const bootstrappedBeforeDeparture = new Set<string>();
    if (isBootstrappedAttachment(state)) bootstrappedBeforeDeparture.add(state.playerId);
    for (const peer of peers) {
      const peerState = peer.deserializeAttachment() as SocketAttachment | null;
      if (isBootstrappedAttachment(peerState)) bootstrappedBeforeDeparture.add(peerState.playerId);
    }
    if (bootstrappedBeforeDeparture.size >= 2) {
      this.ctx.storage.sql.exec(
        "UPDATE room SET last_multi_bootstrap_at = ? WHERE singleton = 1",
        now,
      );
    }
    if (state?.authenticated === true && state.playerId !== null) {
      const samePlayerConnected = peers.some((peer) => {
        const peerState = peer.deserializeAttachment() as SocketAttachment | null;
        return peerState?.authenticated === true && peerState.playerId === state.playerId;
      });
      if (!samePlayerConnected) {
        this.ctx.storage.sql.exec("DELETE FROM active_players WHERE player_id = ?", state.playerId);
        if (room.host_player_id === state.playerId) {
          const connectedIds = peers.flatMap((peer) => {
            const peerState = peer.deserializeAttachment() as SocketAttachment | null;
            return peerState?.authenticated === true && peerState.playerId !== null ? [peerState.playerId] : [];
          });
          const successor = nextHost(this.playerRows().map((player) => player.player_id), connectedIds, room.host_player_id);
          if (successor !== null && successor !== room.host_player_id) {
            this.ctx.storage.sql.exec("UPDATE room SET host_player_id = ? WHERE singleton = 1", successor);
          }
        }
      }
    }
    if (peers.length === 0) {
      const emptySinceAt = room.empty_since_at ?? now;
      this.ctx.storage.sql.exec(
        `UPDATE room SET empty_since_at = COALESCE(empty_since_at, ?), last_heartbeat_at = ?
         WHERE singleton = 1`,
        now,
        now,
      );
      await this.rescheduleAlarm(now);
    } else {
      this.ctx.storage.sql.exec(
        "UPDATE room SET empty_since_at = NULL, last_heartbeat_at = ? WHERE singleton = 1",
        now,
      );
      await this.rescheduleAlarm(now);
    }
    this.scheduleIndexMetadataUpdate();
    this.ctx.waitUntil(this.flushPlayCounts());
  }

  private scheduleIndexMetadataUpdate(): void {
    this.ctx.waitUntil(this.writeIndexMetadata());
  }

  private async rescheduleAlarm(now: number): Promise<void> {
    const room = this.room();
    if (room === null || room.ended_reason !== null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const connectionCount = this.ctx.getWebSockets().length;
    const liveness = planRoomAlarm(now, {
      connectionCount,
      lastHeartbeatAt: room.last_heartbeat_at,
      emptySinceAt: room.empty_since_at,
    }).nextAlarmAt;
    const timer = this.ctx.storage.sql.exec<{ due_at: number }>(
      `SELECT due_at FROM canonical_timers WHERE status = 'scheduled'
       ORDER BY due_at, timer_id LIMIT 1`,
    ).toArray()[0]?.due_at;
    const next = nextRoomAlarmAt(liveness, timer ?? null, connectionCount);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private async writeIndexMetadata(): Promise<void> {
    const room = this.room();
    if (room === null) return;
    const playerCount = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM active_players",
    ).one().count;
    const heartbeatAt = room.last_heartbeat_at ?? Date.now();
    try {
      await this.env.DB.prepare(
        `UPDATE rooms_index SET player_count = ?, last_heartbeat_at = ?, joinable = ?
         WHERE room_id = ? AND ended_at IS NULL`,
      ).bind(playerCount, heartbeatAt, room.quickplay_joinable, room.room_id).run();
    } catch (error) {
      this.logMetadataFailure("liveness", room.room_id, error);
    }
  }

  private recordFirstBootstrap(playerId: string): void {
    this.ctx.storage.transactionSync(() => {
      const exists = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM counted_players WHERE player_id = ?",
        playerId,
      ).one().count > 0;
      if (exists) return;
      this.ctx.storage.sql.exec(
        "INSERT INTO counted_players (player_id, flushed) VALUES (?, 0)",
        playerId,
      );
    });
  }

  private async flushPlayCounts(): Promise<void> {
    const increment = this.ctx.storage.transactionSync(() => {
      const count = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM counted_players WHERE flushed = 0",
      ).one().count;
      if (count > 0) this.ctx.storage.sql.exec("UPDATE counted_players SET flushed = 1 WHERE flushed = 0");
      return count;
    });
    if (increment === 0) return;
    const room = this.room();
    if (room === null) return;
    try {
      await this.env.DB.prepare(
        `UPDATE games SET total_plays = total_plays + ?
         WHERE slug = (SELECT game_slug FROM rooms_index WHERE room_id = ?)`,
      ).bind(increment, room.room_id).run();
    } catch (error) {
      // The local rows were marked flushed before the external write. A failed
      // batch may be lost (allowed), but it can never be applied twice.
      this.logMetadataFailure("total_plays", room.room_id, error);
    }
  }

  private logMetadataFailure(field: string, roomId: string, error: unknown): void {
    console.error(JSON.stringify({
      level: "error",
      message: "room metadata update failed",
      field,
      roomId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  private room(): RoomMetadataRow | null {
    if (!this.tableExists("room")) return null;
    this.ensureRoomSchema();
    return this.ctx.storage.sql.exec<RoomMetadataRow>(
      `SELECT room_id, join_code, release_id, capacity, ended_reason, last_sequence,
              started, initial_snapshot, checkpoint_snapshot, checkpoint_sequence,
              checkpoint_attested, scripted, quickplay_joinable, last_heartbeat_at, empty_since_at,
              last_action_at, last_multi_bootstrap_at, bootstrap_unavailable_logged_at
              , host_player_id, creator_user_id, resumed
       FROM room WHERE singleton = 1`,
    ).toArray()[0] ?? null;
  }

  private requiredRoom(): RoomMetadataRow {
    const room = this.room();
    if (room === null) throw new Error("Room is not initialized");
    return room;
  }

  private loadCore(room: RoomMetadataRow): RoomCore {
    const actions = this.ctx.storage.sql.exec<ActionRow>(
      "SELECT body FROM actions WHERE sequence > ? ORDER BY sequence",
      room.last_sequence - ACTION_RETENTION,
    ).toArray().map((row) => JSON.parse(row.body) as OrderedAction);
    const state: RoomCoreState = { lastSequence: room.last_sequence, actions };
    return new RoomCore(room.room_id.slice(-8), state);
  }

  private loadActionsAfter(sequence: number): OrderedAction[] {
    return this.ctx.storage.sql.exec<ActionRow>(
      "SELECT body FROM actions WHERE sequence > ? ORDER BY sequence",
      sequence,
    ).toArray().map((row) => JSON.parse(row.body) as OrderedAction);
  }

  private players(): PlayerInfo[] {
    const connected = new Set(this.connectedPlayerIds());
    const hostPlayerId = this.requiredRoom().host_player_id;
    return this.playerRows().map((player, index) => ({
      playerId: player.player_id,
      displayName: player.display_name,
      seatId: `seat_${index + 1}`,
      connected: connected.has(player.player_id),
      ...(player.player_id === hostPlayerId ? { host: true } : {}),
    }));
  }

  private playerRows(): PlayerRow[] {
    return this.ctx.storage.sql.exec<PlayerRow>(
      "SELECT player_id, display_name, user_id FROM players ORDER BY rowid",
    ).toArray();
  }

  private connectedPlayerIds(): string[] {
    return [...new Set(this.ctx.getWebSockets().flatMap((socket) => {
      const state = socket.deserializeAttachment() as SocketAttachment | null;
      return state?.authenticated === true && state.playerId !== null ? [state.playerId] : [];
    }))].sort();
  }

  /** Players whose socket completed hello (see `isBootstrappedAttachment`). */
  private bootstrappedPlayerIds(): string[] {
    return [...new Set(this.ctx.getWebSockets().flatMap((socket) => {
      const state = socket.deserializeAttachment() as SocketAttachment | null;
      return isBootstrappedAttachment(state) ? [state.playerId] : [];
    }))].sort();
  }

  private recordMultiBootstrapPresence(now: number): void {
    if (this.bootstrappedPlayerIds().length < 2) return;
    this.ctx.storage.sql.exec(
      "UPDATE room SET last_multi_bootstrap_at = ? WHERE singleton = 1",
      now,
    );
  }

  private logBootstrapUnavailable(room: RoomMetadataRow, core: RoomCore): void {
    const now = Date.now();
    if (room.bootstrap_unavailable_logged_at !== null &&
      now - room.bootstrap_unavailable_logged_at < BOOTSTRAP_UNAVAILABLE_LOG_INTERVAL_MS) return;
    this.ctx.storage.sql.exec(
      "UPDATE room SET bootstrap_unavailable_logged_at = ? WHERE singleton = 1",
      now,
    );
    console.warn(JSON.stringify({
      level: "warn",
      message: "scripted bootstrap unavailable: trimmed log without attested checkpoint",
      roomId: room.room_id,
      retentionFloor: retentionFloor(core.state),
      lastSequence: core.state.lastSequence,
      checkpointSequence: room.checkpoint_sequence,
    }));
  }

  private roomIsScripted(room: RoomMetadataRow): boolean {
    if (room.scripted !== null) return room.scripted === 1;
    if (room.initial_snapshot === null) return false;
    const scripted = snapshotRequiresScripts(this.requiredInitialSnapshot(room));
    this.ctx.storage.sql.exec(
      "UPDATE room SET scripted = ? WHERE singleton = 1 AND scripted IS NULL",
      scripted ? 1 : 0,
    );
    return scripted;
  }

  private consumeCheckpointAttestationRate(playerId: string, now: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<{ window_started_at: number; count: number }>(
        `SELECT window_started_at, count FROM checkpoint_attestation_rates
         WHERE player_id = ?`,
        playerId,
      ).toArray()[0];
      if (row === undefined || now - row.window_started_at >= CHECKPOINT_ATTESTATION_RATE_WINDOW_MS) {
        this.ctx.storage.sql.exec(
          `INSERT INTO checkpoint_attestation_rates (player_id, window_started_at, count)
           VALUES (?, ?, 1)
           ON CONFLICT(player_id) DO UPDATE SET window_started_at = excluded.window_started_at, count = 1`,
          playerId,
          now,
        );
        return true;
      }
      if (row.count >= CHECKPOINT_ATTESTATION_RATE_LIMIT) return false;
      this.ctx.storage.sql.exec(
        "UPDATE checkpoint_attestation_rates SET count = count + 1 WHERE player_id = ?",
        playerId,
      );
      return true;
    });
  }

  private tableExists(name: string): boolean {
    return this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
      name,
    ).one().count === 1;
  }

  private createSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE room (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL,
        join_code TEXT NOT NULL,
        release_id TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        ended_reason TEXT,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        started INTEGER NOT NULL DEFAULT 0,
        initial_snapshot TEXT,
        checkpoint_snapshot TEXT,
        checkpoint_sequence INTEGER,
        checkpoint_attested INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_attested IN (0, 1)),
        scripted INTEGER CHECK (scripted IN (0, 1)),
        quickplay_joinable INTEGER NOT NULL DEFAULT 0 CHECK (quickplay_joinable IN (0, 1)),
        last_heartbeat_at INTEGER,
        empty_since_at INTEGER,
        last_action_at INTEGER,
        last_multi_bootstrap_at INTEGER,
        bootstrap_unavailable_logged_at INTEGER
        , host_player_id TEXT,
        creator_user_id TEXT,
        resumed INTEGER NOT NULL DEFAULT 0 CHECK (resumed IN (0, 1))
      );
      CREATE TABLE players (
        player_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        token_selector TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE
        , user_id TEXT
      );
      CREATE INDEX players_token_selector_idx ON players(token_selector);
      CREATE TABLE actions (
        sequence INTEGER PRIMARY KEY,
        action_id TEXT NOT NULL UNIQUE,
        request_id TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL
      );
      CREATE TABLE request_dedup (
        request_id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL UNIQUE,
        body TEXT NOT NULL
      );
      CREATE TABLE active_players (
        player_id TEXT PRIMARY KEY
      );
      CREATE TABLE counted_players (
        player_id TEXT PRIMARY KEY,
        flushed INTEGER NOT NULL DEFAULT 0 CHECK (flushed IN (0, 1))
      );
      CREATE TABLE canonical_timers (
        timer_id TEXT PRIMARY KEY,
        due_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'fired', 'canceled')),
        deferred_once INTEGER NOT NULL DEFAULT 0 CHECK (deferred_once IN (0, 1))
      );
      CREATE TABLE checkpoint_candidates (
        sequence INTEGER PRIMARY KEY,
        state_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        conflicted INTEGER NOT NULL DEFAULT 0 CHECK (conflicted IN (0, 1))
      );
      CREATE TABLE checkpoint_attesters (
        sequence INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        PRIMARY KEY (sequence, player_id)
      );
      CREATE TABLE checkpoint_attestation_rates (
        player_id TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
  }

  private ensureRoomSchema(): void {
    const columns = new Set(
      this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(room)")
        .toArray()
        .map((column) => column.name),
    );
    if (!columns.has("started")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE room ADD COLUMN started INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!columns.has("initial_snapshot")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN initial_snapshot TEXT");
    }
    if (!columns.has("checkpoint_snapshot")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN checkpoint_snapshot TEXT");
    }
    if (!columns.has("checkpoint_sequence")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN checkpoint_sequence INTEGER");
    }
    if (!columns.has("checkpoint_attested")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE room ADD COLUMN checkpoint_attested INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_attested IN (0, 1))",
      );
    }
    if (!columns.has("scripted")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE room ADD COLUMN scripted INTEGER CHECK (scripted IN (0, 1))",
      );
    }
    if (!columns.has("quickplay_joinable")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE room ADD COLUMN quickplay_joinable INTEGER NOT NULL DEFAULT 0 CHECK (quickplay_joinable IN (0, 1))",
      );
    }
    if (!columns.has("last_heartbeat_at")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN last_heartbeat_at INTEGER");
    }
    if (!columns.has("empty_since_at")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN empty_since_at INTEGER");
    }
    if (!columns.has("last_action_at")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN last_action_at INTEGER");
    }
    if (!columns.has("last_multi_bootstrap_at")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN last_multi_bootstrap_at INTEGER");
    }
    if (!columns.has("bootstrap_unavailable_logged_at")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN bootstrap_unavailable_logged_at INTEGER");
    }
    if (!columns.has("host_player_id")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN host_player_id TEXT");
    }
    if (!columns.has("creator_user_id")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN creator_user_id TEXT");
    }
    if (!columns.has("resumed")) {
      this.ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN resumed INTEGER NOT NULL DEFAULT 0 CHECK (resumed IN (0, 1))");
    }
    const playerColumns = new Set(
      this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(players)").toArray().map((column) => column.name),
    );
    if (!playerColumns.has("user_id")) this.ctx.storage.sql.exec("ALTER TABLE players ADD COLUMN user_id TEXT");
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS active_players (
        player_id TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS counted_players (
        player_id TEXT PRIMARY KEY,
        flushed INTEGER NOT NULL DEFAULT 0 CHECK (flushed IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS canonical_timers (
        timer_id TEXT PRIMARY KEY,
        due_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'fired', 'canceled')),
        deferred_once INTEGER NOT NULL DEFAULT 0 CHECK (deferred_once IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS checkpoint_candidates (
        sequence INTEGER PRIMARY KEY,
        state_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        conflicted INTEGER NOT NULL DEFAULT 0 CHECK (conflicted IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS checkpoint_attesters (
        sequence INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        PRIMARY KEY (sequence, player_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoint_attestation_rates (
        player_id TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
    const timerColumns = new Set(
      this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(canonical_timers)")
        .toArray()
        .map((column) => column.name),
    );
    if (!timerColumns.has("deferred_once")) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE canonical_timers
         ADD COLUMN deferred_once INTEGER NOT NULL DEFAULT 0 CHECK (deferred_once IN (0, 1))`,
      );
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handlePlatformRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "request failed",
        error: error instanceof Error ? error.message : String(error),
        path: new URL(request.url).pathname,
      }));
      return Response.json(
        { error: { code: "internal_error", message: "Internal server error" } },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return Array.from(normalized || "Player").slice(0, 64).join("");
}
