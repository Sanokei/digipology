import { DurableObject } from "cloudflare:workers";
import {
  PROTOCOL_VERSION,
  type ActionRequest,
  type OrderedAction,
  type PlayerInfo,
  type RoomEndedMessage,
  type ServerMessage,
} from "digipology-protocol";
import { hashSelector, sha256Hex, timingSafeHashEqual } from "./crypto";
import {
  handleTextFrame,
  sendServerMessage,
  type ConnectionState,
} from "./message-handler";
import { handlePlatformRequest } from "./platform";
import { generatePlayerId, generateSessionToken } from "./random";
import { ACTION_RETENTION, RoomCore, type RoomCoreState } from "./room-core";

const DEFAULT_ROOM_CAPACITY = 8;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const DUMMY_HASH = "0".repeat(64);

interface RoomMetadataRow extends Record<string, SqlStorageValue> {
  room_id: string;
  join_code: string;
  release_id: string;
  capacity: number;
  ended_reason: "host_ended" | "expired" | "moderation" | null;
  last_sequence: number;
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
  | { status: "ended" };

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
          (singleton, room_id, join_code, release_id, capacity, ended_reason, last_sequence)
         VALUES (1, ?, ?, ?, ?, NULL, 0)`,
        roomId,
        joinCode,
        releaseId,
        capacity,
      );
    });
    return true;
  }

  async join(displayName: string): Promise<JoinResult> {
    const playerId = generatePlayerId();
    const roomToken = generateSessionToken();
    const tokenHash = await sha256Hex(roomToken);
    const tokenSelector = hashSelector(tokenHash);
    return this.ctx.storage.transactionSync(() => {
      const room = this.room();
      if (room === null) return { status: "not_found" };
      if (room.ended_reason !== null) return { status: "ended" };
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
      return {
        status: "ok",
        playerId,
        roomToken,
        releaseId: room.release_id,
        playerCount: count + 1,
      };
    });
  }

  async end(reason: "host_ended" | "expired" | "moderation" = "host_ended"): Promise<boolean> {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return false;
    this.ctx.storage.sql.exec("UPDATE room SET ended_reason = ? WHERE singleton = 1", reason);
    const message: RoomEndedMessage = { type: "room_ended", protocolVersion: PROTOCOL_VERSION, reason };
    for (const socket of this.ctx.getWebSockets()) {
      sendServerMessage(socket, message);
      socket.close(1000, "Room ended");
    }
    try {
      await this.env.DB.prepare(
        "UPDATE rooms_index SET ended_at = ? WHERE room_id = ?",
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
    await this.ctx.storage.deleteAlarm();
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
    if (this.room() !== null && this.ctx.getWebSockets().every((peer) => peer === socket)) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    if (this.room() !== null && this.ctx.getWebSockets().every((peer) => peer === socket)) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
    }
  }

  async alarm(): Promise<void> {
    if (this.room() !== null && this.ctx.getWebSockets().length === 0) {
      await this.end("expired");
    }
  }

  private messageContext(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const state: SocketAttachment = attachment ?? { authenticated: false, playerId: null };
    return {
      state,
      authenticate: (token: string): Promise<string | null> => this.authenticateRoomToken(token),
      hello: (_playerId: string, lastSequence: number | null): ServerMessage => {
        socket.serializeAttachment(state);
        const room = this.requiredRoom();
        if (room.ended_reason !== null) {
          return { type: "room_ended", protocolVersion: PROTOCOL_VERSION, reason: room.ended_reason };
        }
        if (lastSequence === null) {
          return {
            type: "bootstrap",
            protocolVersion: PROTOCOL_VERSION,
            sequence: room.last_sequence,
            players: this.players(),
          };
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
      sequence: (playerId: string, request: ActionRequest) => this.sequence(playerId, request),
      broadcast: (message: ServerMessage): void => {
        for (const peer of this.ctx.getWebSockets()) {
          const peerState = peer.deserializeAttachment() as SocketAttachment | null;
          if (peerState?.authenticated === true) sendServerMessage(peer, message);
        }
      },
    };
  }

  private async authenticateRoomToken(token: string): Promise<string | null> {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return null;
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
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<ActionRow>(
        "SELECT body FROM request_dedup WHERE request_id = ?",
        request.requestId,
      ).toArray()[0];
      if (existing !== undefined) {
        return { message: JSON.parse(existing.body) as OrderedAction, duplicate: true };
      }

      const room = this.requiredRoom();
      const result = this.loadCore(room).sequence(request, playerId);
      this.ctx.storage.sql.exec(
        "UPDATE room SET last_sequence = ? WHERE singleton = 1",
        result.orderedAction.sequence,
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
      return { message: result.orderedAction, duplicate: false };
    });
  }

  private room(): RoomMetadataRow | null {
    if (!this.tableExists("room")) return null;
    return this.ctx.storage.sql.exec<RoomMetadataRow>(
      `SELECT room_id, join_code, release_id, capacity, ended_reason, last_sequence
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
    return this.ctx.storage.sql.exec<PlayerRow>(
      "SELECT player_id, display_name FROM players ORDER BY rowid",
    ).toArray().map((player) => ({
      playerId: player.player_id,
      displayName: player.display_name,
      seatId: null,
      connected: connected.has(player.player_id),
    }));
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
        last_sequence INTEGER NOT NULL DEFAULT 0
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
    `);
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
