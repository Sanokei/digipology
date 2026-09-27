import { expect, test } from "bun:test";
import { formatKernelEvent } from "./tableLogModel";

const players = [{ playerId: "alice", displayName: "Alice", seatId: "red", connected: true }];

test("formats human-readable game events and hides script failures from guests", () => {
  expect(formatKernelEvent({ type: "deck.drawn", sequence: 4, actionId: "draw", data: { playerId: "alice", items: ["a", "b"] } }, players, false)?.text).toBe("Alice drew 2 cards.");
  expect(formatKernelEvent({ type: "die.rolled", sequence: 5, actionId: "roll", data: { playerId: "alice", value: 5 } }, players, false)?.text).toBe("Alice rolled 5.");
  const error = { type: "script.error", sequence: 6, actionId: "script", data: { message: "boom" } };
  expect(formatKernelEvent(error, players, false)).toBeNull();
  expect(formatKernelEvent(error, players, true)?.text).toBe("Script error: boom");
});
