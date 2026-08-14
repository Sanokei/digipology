import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ProtocolErrorCode,
  type ServerMessage,
} from "digipology-protocol";

export interface MessageSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectionState {
  authenticated: boolean;
  playerId: string | null;
}

export interface MessageHandlerContext {
  state: ConnectionState;
  authenticate(token: string): string | null;
  hello(playerId: string, lastSequence: number | null): ServerMessage;
  sequence(playerId: string, message: Extract<ClientMessage, { type: "action_request" }>): {
    message: ServerMessage;
    duplicate: boolean;
  };
  broadcast(message: ServerMessage): void;
}

export function handleTextFrame(
  socket: MessageSocket,
  raw: string,
  context: MessageHandlerContext,
): void {
  const parsed = parseClientMessage(raw);
  if (!parsed.ok) {
    sendProtocolError(socket, parsed.error.code, parsed.error.detail);
    if (!context.state.authenticated) socket.close(1002, "Invalid hello");
    return;
  }

  if (!context.state.authenticated) {
    if (parsed.message.type !== "hello") {
      sendProtocolError(socket, "malformed_message", "The first frame must be hello");
      socket.close(1002, "Expected hello");
      return;
    }
    const playerId = context.authenticate(parsed.message.sessionToken);
    if (playerId === null) {
      sendProtocolError(socket, "invalid_session", "The room session is not valid");
      socket.close(1008, "Invalid session");
      return;
    }
    context.state.authenticated = true;
    context.state.playerId = playerId;
    sendServerMessage(socket, context.hello(playerId, parsed.message.lastSequence));
    return;
  }

  if (parsed.message.type === "hello") {
    sendProtocolError(socket, "malformed_message", "hello may only be sent once");
    return;
  }
  if (parsed.message.type === "ping") {
    sendServerMessage(socket, {
      type: "pong",
      protocolVersion: PROTOCOL_VERSION,
      ...(parsed.message.t === undefined ? {} : { t: parsed.message.t }),
    });
    return;
  }

  const playerId = context.state.playerId;
  if (playerId === null) throw new Error("Authenticated socket has no player ID");
  const result = context.sequence(playerId, parsed.message);
  if (result.duplicate) sendServerMessage(socket, result.message);
  else context.broadcast(result.message);
}

export function sendServerMessage(socket: MessageSocket, message: ServerMessage): void {
  const wire = JSON.stringify(message);
  const verified = parseServerMessage(wire);
  if (!verified.ok) {
    throw new Error(`Invalid outbound protocol message: ${verified.error.detail}`);
  }
  socket.send(wire);
}

function sendProtocolError(
  socket: MessageSocket,
  code: ProtocolErrorCode,
  message: string,
): void {
  sendServerMessage(socket, {
    type: "protocol_error",
    protocolVersion: PROTOCOL_VERSION,
    code,
    message,
  });
}
