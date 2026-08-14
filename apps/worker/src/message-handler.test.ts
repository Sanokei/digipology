import { describe, expect, test } from "bun:test";
import { parseServerMessage, type ActionRequest, type ServerMessage } from "digipology-protocol";
import { handleTextFrame, type ConnectionState, type MessageHandlerContext, type MessageSocket } from "./message-handler";
import { RoomCore } from "./room-core";

class MockSocket implements MessageSocket {
  sent: ServerMessage[] = [];
  closed: [number | undefined, string | undefined] | null = null;
  send(wire: string): void {
    const parsed = parseServerMessage(wire);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    this.sent.push(parsed.message);
  }
  close(code?: number, reason?: string): void { this.closed = [code, reason]; }
}

function context(core = new RoomCore("room123"), token = "valid"): MessageHandlerContext & { broadcasts: ServerMessage[] } {
  const state: ConnectionState = { authenticated: false, playerId: null };
  const broadcasts: ServerMessage[] = [];
  return {
    state,
    broadcasts,
    authenticate: (candidate) => Promise.resolve(candidate === token ? "player_alice" : null),
    hello: (_playerId, lastSequence) => lastSequence === null
      ? { type: "bootstrap", protocolVersion: 1, sequence: core.state.lastSequence, players: [] }
      : core.resumeAfter(lastSequence).type === "resume"
        ? (core.resumeAfter(lastSequence) as Extract<ReturnType<RoomCore["resumeAfter"]>, { type: "resume" }>).message
        : { type: "resync_required", protocolVersion: 1 },
    sequence: (playerId, message: ActionRequest) => {
      const result = core.sequence(message, playerId);
      return { message: result.orderedAction, duplicate: result.duplicate };
    },
    broadcast: (message) => { broadcasts.push(message); },
  };
}

describe("protocol message handler", () => {
  test("feeds committed hello and Appendix D.4 action fixtures through the handler", async () => {
    const hello = (await Bun.file(new URL("../../../packages/protocol/fixtures/hello.json", import.meta.url)).text()).trim();
    const action = (await Bun.file(new URL("../../../packages/protocol/fixtures/appendix-d4-action-request.json", import.meta.url)).text()).trim();
    const socket = new MockSocket();
    const ctx = context(new RoomCore("room123"), "session_alice");
    await handleTextFrame(socket, hello, ctx);
    await handleTextFrame(socket, action, ctx);
    expect(socket.sent[0]?.type).toBe("bootstrap");
    expect(ctx.broadcasts).toHaveLength(1);
    expect(ctx.broadcasts[0]).toMatchObject({ type: "ordered_action", sequence: 1, actor: { type: "player", playerId: "player_alice" } });
  });

  test("rejects malformed JSON, wrong versions, oversized frames, and bad sessions", async () => {
    const cases: Array<[string, string, number]> = [
      ["{", "malformed_message", 1002],
      [JSON.stringify({ type: "hello", protocolVersion: 2, sessionToken: "valid", lastSequence: null }), "unsupported_protocol_version", 1002],
      [JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: "x".repeat(5000), lastSequence: null }), "message_too_large", 1002],
      [JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: "bad", lastSequence: null }), "invalid_session", 1008],
    ];
    for (const [wire, code, closeCode] of cases) {
      const socket = new MockSocket();
      await handleTextFrame(socket, wire, context());
      expect(socket.sent.at(-1)).toMatchObject({ type: "protocol_error", code });
      expect(socket.closed?.[0]).toBe(closeCode);
    }
  });

  test("returns duplicate ordered action only to its requester", async () => {
    const socket = new MockSocket();
    const ctx = context();
    await handleTextFrame(socket, JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: "valid", lastSequence: null }), ctx);
    const action = JSON.stringify({ type: "action_request", protocolVersion: 1, requestId: "req_1", predictedAtSequence: 0, action: { type: "x", payload: null } });
    await handleTextFrame(socket, action, ctx);
    await handleTextFrame(socket, action, ctx);
    expect(ctx.broadcasts).toHaveLength(1);
    expect(socket.sent.at(-1)).toEqual(ctx.broadcasts[0]);
  });

  test("sends bootstrap before its ordered catch-up stream", async () => {
    const socket = new MockSocket();
    const ctx = context();
    ctx.hello = () => [
      { type: "bootstrap", protocolVersion: 1, sequence: 0, snapshot: {}, players: [] },
      ctx.sequence("player_alice", {
        type: "action_request",
        protocolVersion: 1,
        requestId: "start",
        predictedAtSequence: 0,
        action: { type: "system.game_start", payload: {} },
      }).message,
    ];
    await handleTextFrame(socket, JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      sessionToken: "valid",
      lastSequence: null,
    }), ctx);
    expect(socket.sent.map((message) => message.type)).toEqual([
      "bootstrap",
      "ordered_action",
    ]);
  });

  test("records a play only after every bootstrap frame is sent", async () => {
    const events: string[] = [];
    const socket = new MockSocket();
    const originalSend = socket.send.bind(socket);
    socket.send = (wire) => { originalSend(wire); events.push("sent"); };
    const ctx = context();
    ctx.afterHelloSent = async () => { events.push("counted"); };
    await handleTextFrame(socket, JSON.stringify({
      type: "hello", protocolVersion: 1, sessionToken: "valid", lastSequence: null,
    }), ctx);
    expect(events).toEqual(["sent", "counted"]);
  });

  test("sends room_ended and closes cleanly for legacy and subsequent hellos", async () => {
    let endedReason: "expired" | null = null;
    const hello = JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      sessionToken: "valid",
      lastSequence: null,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const socket = new MockSocket();
      const ctx = context();
      ctx.hello = () => {
        endedReason ??= "expired";
        return { type: "room_ended", protocolVersion: 1, reason: endedReason };
      };
      await expect(handleTextFrame(socket, hello, ctx)).resolves.toBeUndefined();
      expect(socket.sent).toEqual([
        { type: "room_ended", protocolVersion: 1, reason: "expired" },
      ]);
      expect(socket.closed).toEqual([1000, "Room ended"]);
    }
  });
});
