import {
  PROTOCOL_VERSION,
  type ClientSocialMessage,
  type ServerSocialMessage,
} from "digipology-protocol";

export interface RoomSocialIdentity {
  playerId: string;
  displayName: string;
  seatId: string | null;
}

export function relaySocialMessage(
  identity: RoomSocialIdentity,
  message: Exclude<ClientSocialMessage, { type: "social_subscribe" }>,
): ServerSocialMessage {
  if (message.type === "chat_send") {
    return {
      type: "chat_message",
      protocolVersion: PROTOCOL_VERSION,
      kind: "player",
      playerId: identity.playerId,
      displayName: identity.displayName,
      text: message.text.trim(),
    };
  }
  return {
    type: message.type,
    protocolVersion: PROTOCOL_VERSION,
    playerId: identity.playerId,
    displayName: identity.displayName,
    seatId: identity.seatId,
    x: message.x,
    z: message.z,
  };
}

export function presenceChatMessage(
  displayName: string,
  presence: "joined" | "left",
): ServerSocialMessage {
  return {
    type: "chat_message",
    protocolVersion: PROTOCOL_VERSION,
    kind: "system",
    text: `${displayName} ${presence} the table.`,
  };
}
