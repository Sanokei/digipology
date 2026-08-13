import type { ClientMessage, ServerMessage } from "./index";

function assertNever(value: never): never {
  throw new Error(`Unexpected message: ${String(value)}`);
}

export function exhaustClientMessage(message: ClientMessage): string {
  switch (message.type) {
    case "hello":
    case "action_request":
    case "ping":
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
      return message.type;
    default:
      return assertNever(message);
  }
}
