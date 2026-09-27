import { describe, expect, test } from "bun:test";

import { CHAT_HISTORY_LIMIT, CursorThrottle, createChatModel, reduceChatModel } from "./tableSocialModel";

describe("chat model", () => {
  test("counts unread lines only while collapsed and bounds transient history", () => {
    let model = createChatModel();
    model = reduceChatModel(model, {
      type: "message",
      message: { type: "chat_message", protocolVersion: 1, kind: "system", text: "Alice joined." },
    });
    expect(model.unread).toBe(1);
    model = reduceChatModel(model, { type: "open" });
    expect(model.unread).toBe(0);
    for (let index = 0; index < CHAT_HISTORY_LIMIT + 3; index += 1) {
      model = reduceChatModel(model, {
        type: "message",
        message: {
          type: "chat_message",
          protocolVersion: 1,
          kind: "player",
          playerId: "alice",
          displayName: "Alice",
          text: `line ${index}`,
        },
      });
    }
    expect(model.lines).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(model.lines.at(-1)?.message.text).toBe(`line ${CHAT_HISTORY_LIMIT + 2}`);
    expect(model.unread).toBe(0);
  });
});

test("cursor throttle sends immediately, then coalesces to the latest point at 12.5 Hz", () => {
  let now = 0;
  let callback: (() => void) | null = null;
  const sent: number[] = [];
  const throttle = new CursorThrottle<number>(
    (value) => sent.push(value),
    80,
    () => now,
    {
      set(next) { callback = next; return 1 as unknown as ReturnType<typeof setTimeout>; },
      clear() { callback = null; },
    },
  );
  throttle.push(1);
  now = 20;
  throttle.push(2);
  now = 70;
  throttle.push(3);
  expect(sent).toEqual([1]);
  now = 80;
  const flush = callback as (() => void) | null;
  flush?.();
  expect(sent).toEqual([1, 3]);
  now = 160;
  throttle.push(4);
  expect(sent).toEqual([1, 3, 4]);
});
