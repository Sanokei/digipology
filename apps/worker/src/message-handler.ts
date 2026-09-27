import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ClientSocialMessage,
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
  socialSubscribed?: boolean;
  chatWindowStartedAt?: number;
  chatCount?: number;
}

export const CHAT_RATE_LIMIT = 5;
export const CHAT_RATE_WINDOW_MS = 10_000;

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
  socialSubscribe?(playerId: string): void;
  relaySocial?(
    playerId: string,
    message: Exclude<ClientSocialMessage, { type: "social_subscribe" }>,
  ): ServerMessage;
  broadcastSocial?(message: ServerMessage): void;
  now?(): number;
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
  if (parsed.message.type === "social_subscribe") {
    if (context.socialSubscribe === undefined) {
      sendProtocolError(socket, "unknown_message_type", "Social messages are not supported by this room");
      return Promise.resolve();
    }
    context.state.socialSubscribed = true;
    context.socialSubscribe(playerId);
    return Promise.resolve();
  }
  if (
    parsed.message.type === "chat_send" ||
    parsed.message.type === "cursor_update" ||
    parsed.message.type === "table_ping"
  ) {
    if (context.state.socialSubscribed !== true || context.relaySocial === undefined || context.broadcastSocial === undefined) {
      sendProtocolError(socket, "unknown_message_type", "Subscribe to room social messages first");
      return Promise.resolve();
    }
    if (parsed.message.type === "chat_send" && !consumeChatRate(context.state, context.now?.() ?? Date.now())) {
      sendProtocolError(socket, "rate_limited", "Chat is limited to 5 messages every 10 seconds");
      return Promise.resolve();
    }
    context.broadcastSocial(context.relaySocial(playerId, parsed.message));
    return Promise.resolve();
  }
  const result = context.sequence(playerId, parsed.message);
  if (result.duplicate) sendServerMessage(socket, result.message);
  else context.broadcast(result.message);
  return Promise.resolve();
}

function consumeChatRate(state: ConnectionState, now: number): boolean {
  if (
    state.chatWindowStartedAt === undefined ||
    state.chatCount === undefined ||
    now - state.chatWindowStartedAt >= CHAT_RATE_WINDOW_MS ||
    now < state.chatWindowStartedAt
  ) {
    state.chatWindowStartedAt = now;
    state.chatCount = 1;
    return true;
  }
  state.chatCount += 1;
  return state.chatCount <= CHAT_RATE_LIMIT;
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
