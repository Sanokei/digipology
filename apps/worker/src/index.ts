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
  handleTextFrame,
  sendServerMessage,
  type ConnectionState,
} from "./message-handler";
import { generateJoinCode, generatePlayerId, generateSessionToken, normalizeJoinCode } from "./random";
import { ACTION_RETENTION, RoomCore, type RoomCoreState } from "./room-core";

const DEFAULT_ROOM_CAPACITY = 8;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const HTTP_BODY_LIMIT = 4 * 1024;

interface RoomMetadataRow extends Record<string, SqlStorageValue> {
  room_id: string;
  join_code: string;
  capacity: number;
  ended_reason: "host_ended" | "expired" | "moderation" | null;
  last_sequence: number;
}

interface PlayerRow extends Record<string, SqlStorageValue> {
  player_id: string;
  display_name: string;
  session_token: string;
}

interface ActionRow extends Record<string, SqlStorageValue> {
  body: string;
}

type SocketAttachment = ConnectionState;

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_id TEXT NOT NULL,
          join_code TEXT NOT NULL,
          capacity INTEGER NOT NULL,
          ended_reason TEXT,
          last_sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS players (
          player_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          session_token TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS actions (
          sequence INTEGER PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          body TEXT NOT NULL
        );
      `);
    });
  }

  init(roomId: string, joinCode: string, capacity = DEFAULT_ROOM_CAPACITY): boolean {
    const existing = this.room();
    if (existing !== null) return false;
    this.ctx.storage.sql.exec(
      "INSERT INTO room (singleton, room_id, join_code, capacity, ended_reason, last_sequence) VALUES (1, ?, ?, ?, NULL, 0)",
      roomId,
      joinCode,
      capacity,
    );
    return true;
  }

  join(displayName: string): { status: "ok"; playerId: string; sessionToken: string } | { status: "not_found" | "full" } {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return { status: "not_found" };
    const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM players").one().count;
    if (count >= room.capacity) return { status: "full" };
    const playerId = generatePlayerId();
    const sessionToken = generateSessionToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO players (player_id, display_name, session_token) VALUES (?, ?, ?)",
      playerId,
      displayName,
      sessionToken,
    );
    return { status: "ok", playerId, sessionToken };
  }

  end(reason: "host_ended" | "expired" | "moderation" = "host_ended"): boolean {
    const room = this.room();
    if (room === null || room.ended_reason !== null) return false;
    this.ctx.storage.sql.exec("UPDATE room SET ended_reason = ? WHERE singleton = 1", reason);
    const message: RoomEndedMessage = { type: "room_ended", protocolVersion: PROTOCOL_VERSION, reason };
    for (const socket of this.ctx.getWebSockets()) {
      sendServerMessage(socket, message);
      socket.close(1000, "Room ended");
    }
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authenticated: false, playerId: null } satisfies SocketAttachment);
    await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer): void {
    if (typeof frame !== "string") {
      handleTextFrame(socket, "", this.messageContext(socket));
      return;
    }
    const context = this.messageContext(socket);
    handleTextFrame(socket, frame, context);
    socket.serializeAttachment(context.state);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    if (this.ctx.getWebSockets().every((peer) => peer === socket)) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    if (this.ctx.getWebSockets().every((peer) => peer === socket)) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
    }
  }

  alarm(): void {
    if (this.ctx.getWebSockets().length === 0) this.end("expired");
  }

  private messageContext(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const state: SocketAttachment = attachment ?? { authenticated: false, playerId: null };
    return {
      state,
      authenticate: (token: string): string | null => {
        const room = this.room();
        if (room === null) return null;
        const player = this.ctx.storage.sql.exec<{ player_id: string }>(
          "SELECT player_id FROM players WHERE session_token = ?",
          token,
        ).toArray()[0];
        if (player === undefined) return null;
        const players = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM players").one().count;
        return players <= room.capacity ? player.player_id : null;
      },
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

  private sequence(playerId: string, request: ActionRequest): { message: OrderedAction; duplicate: boolean } {
    return this.ctx.storage.transactionSync(() => {
      const room = this.requiredRoom();
      const core = this.loadCore(room);
      const result = core.sequence(request, playerId);
      if (!result.duplicate) {
        this.ctx.storage.sql.exec(
          "UPDATE room SET last_sequence = ? WHERE singleton = 1",
          result.orderedAction.sequence,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO actions (sequence, request_id, body) VALUES (?, ?, ?)",
          result.orderedAction.sequence,
          request.requestId,
          JSON.stringify(result.orderedAction),
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM actions WHERE sequence <= ?",
          result.orderedAction.sequence - ACTION_RETENTION,
        );
      }
      return { message: result.orderedAction, duplicate: result.duplicate };
    });
  }

  private room(): RoomMetadataRow | null {
    return this.ctx.storage.sql.exec<RoomMetadataRow>("SELECT room_id, join_code, capacity, ended_reason, last_sequence FROM room WHERE singleton = 1").toArray()[0] ?? null;
  }

  private requiredRoom(): RoomMetadataRow {
    const room = this.room();
    if (room === null) throw new Error("Room is not initialized");
    return room;
  }

  private loadCore(room: RoomMetadataRow): RoomCore {
    const actions = this.ctx.storage.sql.exec<ActionRow>("SELECT body FROM actions ORDER BY sequence").toArray().map((row) => JSON.parse(row.body) as OrderedAction);
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
    return this.ctx.storage.sql.exec<PlayerRow>("SELECT player_id, display_name, session_token FROM players ORDER BY rowid").toArray().map((player) => ({
      playerId: player.player_id,
      displayName: player.display_name,
      seatId: null,
      connected: connected.has(player.player_id),
    }));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: "request failed", error: error instanceof Error ? error.message : String(error), path: new URL(request.url).pathname }));
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJsonObject(request);
    if (body === null || Object.keys(body).length !== 0) return jsonError(400, "Expected an empty JSON object");
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const joinCode = generateJoinCode();
      const id = env.ROOM.idFromName(joinCode);
      const roomId = id.toString();
      const initialized = await env.ROOM.get(id).init(roomId, joinCode);
      if (initialized) {
        return jsonResponse({ roomId, joinCode, wsUrl: websocketUrl(url, roomId) }, 201);
      }
    }
    return jsonError(503, "Could not allocate a room code");
  }
  if (request.method === "POST" && url.pathname === "/api/rooms/join") {
    const body = await readJsonObject(request);
    if (body === null || typeof body.joinCode !== "string" || (body.displayName !== undefined && typeof body.displayName !== "string")) {
      return jsonError(400, "Expected joinCode and optional displayName strings");
    }
    const joinCode = normalizeJoinCode(body.joinCode);
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/.test(joinCode)) return jsonError(404, "Room not found");
    const id = env.ROOM.idFromName(joinCode);
    const result = await env.ROOM.get(id).join(normalizeDisplayName(body.displayName));
    if (result.status === "not_found") return jsonError(404, "Room not found or ended");
    if (result.status === "full") return jsonError(409, "Room is full");
    if (result.status !== "ok") return jsonError(500, "Unexpected join result");
    const roomId = id.toString();
    return jsonResponse({ roomId, playerId: result.playerId, sessionToken: result.sessionToken, wsUrl: websocketUrl(url, roomId) });
  }
  const match = /^\/api\/rooms\/([0-9a-f]{64})\/ws$/.exec(url.pathname);
  if (request.method === "GET" && match?.[1] !== undefined) {
    return env.ROOM.get(env.ROOM.idFromString(match[1])).fetch(request);
  }
  const endMatch = /^\/api\/rooms\/([0-9a-f]{64})\/end$/.exec(url.pathname);
  if (request.method === "POST" && endMatch?.[1] !== undefined) {
    const ended = await env.ROOM.get(env.ROOM.idFromString(endMatch[1])).end();
    return ended ? new Response(null, { status: 204 }) : jsonError(404, "Room not found or already ended");
  }
  return jsonError(404, "Not found");
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > HTTP_BODY_LIMIT) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > HTTP_BODY_LIMIT) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") return "Player";
  const normalized = value.trim().replaceAll(/\s+/g, " ").slice(0, 64);
  return normalized || "Player";
}

function websocketUrl(url: URL, roomId: string): string {
  const ws = new URL(`/api/rooms/${roomId}/ws`, url);
  ws.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return ws.toString();
}

function jsonError(status: number, error: string): Response {
  return jsonResponse({ error }, status);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
