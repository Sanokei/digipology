import type { ClientMessage, ServerMessage } from "./index";

function assertNever(value: never): never {
  throw new Error(`Unexpected message: ${String(value)}`);
}

export function exhaustClientMessage(message: ClientMessage): string {
  switch (message.type) {
    case "hello":
    case "action_request":
    case "ping":
    case "social_subscribe":
    case "chat_send":
    case "cursor_update":
    case "table_ping":
      return message.type;
    default:
      return assertNever(message);
  }
}

export function exhaustServerMessage(message: ServerMessage): string {
  switch (message.type) {
    case "bootstrap":
    case "resume":
    case "resync_required":
    case "protocol_error":
    case "room_ended":
    case "ordered_action":
    case "pong":
    case "chat_message":
    case "cursor_update":
    case "table_ping":
    case "players_updated":
    case "room_redirect":
    case "room_kicked":
      return message.type;
    default:
      return assertNever(message);
  }
}
