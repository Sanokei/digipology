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
  bootstrapped: boolean;
}

export interface MessageHandlerContext {
  state: ConnectionState;
  authenticate(token: string): Promise<string | null>;
  hello(
    playerId: string,
    lastSequence: number | null,
  ): ServerMessage | readonly ServerMessage[] | Promise<ServerMessage | readonly ServerMessage[]>;
  afterHelloSent?(
    playerId: string,
    messages: readonly ServerMessage[],
  ): void | Promise<void>;
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
): Promise<void> {
  const parsed = parseClientMessage(raw);
  if (!parsed.ok) {
    sendProtocolError(socket, parsed.error.code, parsed.error.detail);
    if (!context.state.authenticated) socket.close(1002, "Invalid hello");
    return Promise.resolve();
  }

  if (!context.state.authenticated) {
    if (parsed.message.type !== "hello") {
      sendProtocolError(socket, "malformed_message", "The first frame must be hello");
      socket.close(1002, "Expected hello");
      return Promise.resolve();
    }
    return handleHello(socket, context, parsed.message.sessionToken, parsed.message.lastSequence);
  }

  if (parsed.message.type === "hello") {
    sendProtocolError(socket, "malformed_message", "hello may only be sent once");
    return Promise.resolve();
  }
  if (parsed.message.type === "ping") {
    sendServerMessage(socket, {
      type: "pong",
      protocolVersion: PROTOCOL_VERSION,
      ...(parsed.message.t === undefined ? {} : { t: parsed.message.t }),
    });
    return Promise.resolve();
  }

  const playerId = context.state.playerId;
  if (playerId === null) throw new Error("Authenticated socket has no player ID");
  const result = context.sequence(playerId, parsed.message);
  if (result.duplicate) sendServerMessage(socket, result.message);
  else context.broadcast(result.message);
  return Promise.resolve();
}

async function handleHello(
  socket: MessageSocket,
  context: MessageHandlerContext,
  token: string,
  lastSequence: number | null,
): Promise<void> {
  const playerId = await context.authenticate(token);
  if (playerId === null) {
    sendProtocolError(socket, "invalid_session", "The room session is not valid");
    socket.close(1008, "Invalid session");
    return;
  }
  context.state.authenticated = true;
  context.state.playerId = playerId;
  const helloResult = await context.hello(playerId, lastSequence);
  const messages = Array.isArray(helloResult) ? helloResult : [helloResult];
  for (const message of messages) {
    sendServerMessage(socket, message);
  }
  await context.afterHelloSent?.(playerId, messages);
  if (messages.some((message) => message.type === "room_ended")) {
    socket.close(1000, "Room ended");
  } else if (messages.some(
    (message) => message.type === "protocol_error" && message.code === "bootstrap_unavailable",
  )) {
    socket.close(4002, "Bootstrap unavailable");
  }
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
