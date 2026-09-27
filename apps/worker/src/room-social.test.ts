import { expect, test } from "bun:test";

import { presenceChatMessage, relaySocialMessage } from "./room-social";

test("social relay overwrites all identity from the authenticated server session", () => {
  const identity = { playerId: "server-player", displayName: "Alice", seatId: "seat_2" };
  expect(relaySocialMessage(identity, {
    type: "chat_send", protocolVersion: 1, text: "  hello  ",
  })).toEqual({
    type: "chat_message",
    protocolVersion: 1,
    kind: "player",
    playerId: "server-player",
    displayName: "Alice",
    text: "hello",
  });
  expect(relaySocialMessage(identity, {
    type: "cursor_update", protocolVersion: 1, x: 2, z: -3,
  })).toEqual({
    type: "cursor_update",
    protocolVersion: 1,
    playerId: "server-player",
    displayName: "Alice",
    seatId: "seat_2",
    x: 2,
    z: -3,
  });
  expect(presenceChatMessage("Alice", "left")).toMatchObject({
    kind: "system",
    text: "Alice left the table.",
  });
});
