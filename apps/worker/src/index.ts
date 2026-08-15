import { DurableObject } from "cloudflare:workers";
import {
  PROTOCOL_VERSION,
  type ActionRequest,
  type OrderedAction,
  type PlayerInfo,
  type RoomEndedMessage,
  type ServerMessage,
} from "digipology-protocol";
import { loadSnapshot, snapshot, type GameSnapshot } from "digipology-kernel";
import type { ReleaseBundleDto } from "digipology-protocol/http";
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
  checkpointBaseConnects,
  checkpointIsDue,
  replayCheckpoint,
  RoomCore,
  roomBootstrapFromSnapshots,
  TIMER_CANCEL_GRACE_MS,
  timerFireDedupKey,
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
  quickplay_joinable: number;
  last_heartbeat_at: number | null;
  empty_since_at: number | null;
  last_action_at: number | null;
}

interface PlayerRow extends Record<string, SqlStorageValue> {
  player_id: string;
  display_name: string;
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

type SocketAttachment = ConnectionState;

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

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  init(
    roomId: string,
    joinCode: string,
    releaseId: string,
    capacity = DEFAULT_ROOM_CAPACITY,
  ): boolean {
    if (this.room() !== null) return false;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) return false;
    this.ctx.storage.transactionSync(() => {
      this.createSchema();
      this.ctx.storage.sql.exec(
        `INSERT INTO room
          (singleton, room_id, join_code, release_id, capacity, ended_reason,
           last_sequence, quickplay_joinable)
         VALUES (1, ?, ?, ?, ?, NULL, 0, 1)`,
        roomId,
        joinCode,
        releaseId,
        capacity,
      );
    });
    return true;
  }

  async join(displayName: string, requireQuickPlayJoinable = false): Promise<JoinResult> {
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
          (player_id, display_name, token_selector, token_hash)
         VALUES (?, ?, ?, ?)`,
        playerId,
        normalizeDisplayName(displayName),
        tokenSelector,
        tokenHash,
      );
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
    server.serializeAttachment({ authenticated: false, playerId: null } satisfies SocketAttachment);
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
    const state: SocketAttachment = attachment ?? { authenticated: false, playerId: null };
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
          const checkpoint = core.resumeAfter(initialSnapshot.sequence).type === "resync_required"
            ? this.storedCheckpoint(room)
            : null;
          return roomBootstrapFromSnapshots(
            core,
            initialSnapshot,
            checkpoint,
            this.players(),
          );
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
      this.ctx.storage.sql.exec(
        "DELETE FROM actions WHERE sequence <= ?",
        result.orderedAction.sequence - ACTION_RETENTION,
      );
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
    const builtinState = createBuiltinInitialState(before.release_id, roster);
    const baseSnapshot = builtinState === null
      ? await this.uploadedInitialSnapshot(before.release_id)
      : snapshot(builtinState);
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
      const started = core.sequenceSystem(
        { type: "system.game_start", payload: { settings: initialState.settings } },
        "game_start",
      );
      this.persistSystemAction(started.orderedAction);
      if (builtinState === null) {
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
         SET started = 1, initial_snapshot = ?, last_sequence = ?
         WHERE singleton = 1`,
        JSON.stringify(baseSnapshot),
        core.state.lastSequence,
      );
    });
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

  private storedCheckpoint(room: RoomMetadataRow): GameSnapshot | null {
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
      `UPDATE room SET checkpoint_snapshot = ?, checkpoint_sequence = ?
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
    this.ctx.storage.sql.exec(
      "DELETE FROM actions WHERE sequence <= ?",
      ordered.sequence - ACTION_RETENTION,
    );
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
    if (state?.authenticated === true && state.playerId !== null) {
      const samePlayerConnected = peers.some((peer) => {
        const peerState = peer.deserializeAttachment() as SocketAttachment | null;
        return peerState?.authenticated === true && peerState.playerId === state.playerId;
      });
      if (!samePlayerConnected) {
        this.ctx.storage.sql.exec("DELETE FROM active_players WHERE player_id = ?", state.playerId);
      }
    }
    const now = Date.now();
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
              quickplay_joinable, last_heartbeat_at, empty_since_at, last_action_at
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
      "SELECT body FROM actions ORDER BY sequence",
    ).toArray().map((row) => JSON.parse(row.body) as OrderedAction);
    const state: RoomCoreState = { lastSequence: room.last_sequence, actions };
    return new RoomCore(room.room_id.slice(-8), state);
  }

  private players(): PlayerInfo[] {
    const connected = new Set(
      this.ctx.getWebSockets().flatMap((socket) => {
        const state = socket.deserializeAttachment() as SocketAttachment | null;
        return state?.authenticated === true && state.playerId !== null ? [state.playerId] : [];
      }),
    );
    return this.playerRows().map((player, index) => ({
      playerId: player.player_id,
      displayName: player.display_name,
      seatId: `seat_${index + 1}`,
      connected: connected.has(player.player_id),
    }));
  }

  private playerRows(): PlayerRow[] {
    return this.ctx.storage.sql.exec<PlayerRow>(
      "SELECT player_id, display_name FROM players ORDER BY rowid",
    ).toArray();
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
        quickplay_joinable INTEGER NOT NULL DEFAULT 0 CHECK (quickplay_joinable IN (0, 1)),
        last_heartbeat_at INTEGER,
        empty_since_at INTEGER,
        last_action_at INTEGER
      );
      CREATE TABLE players (
        player_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        token_selector TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE
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
