import { describe, expect, test } from "bun:test";

import { createHoverPicker, handleTouchPointerInput } from "./sceneInteraction";
import { TouchGestureMachine } from "./touchGestures";

describe("async adapter picking preserves gesture thresholds", () => {
  test("resolves the target before starting the long-press clock", async () => {
    let resolvePick: ((entityId: string | null) => void) | undefined;
    const pick = new Promise<string | null>((resolve) => {
      resolvePick = resolve;
    });
    const gestures = new TouchGestureMachine();
    const pending = handleTouchPointerInput(
      gestures,
      { pick: () => pick, isGrabbable: () => true },
      {
        type: "down",
        pointerId: 7,
        x: 20,
        y: 30,
        pickX: 10,
        pickY: 15,
        timestamp: 100,
        pointerType: "touch",
      },
    );

    expect(gestures.nextDeadline()).toBeNull();
    resolvePick?.("card-1");
    expect(await pending).toEqual([]);
    expect(gestures.nextDeadline()).toBe(550);
    expect(gestures.advance(549)).toEqual([]);
    expect(gestures.advance(550)).toEqual([
      { type: "long-press", entityId: "card-1", x: 20, y: 30 },
    ]);
  });

  test("uses an async-picked entity for drag without changing the move threshold", async () => {
    const gestures = new TouchGestureMachine();
    const adapter = { pick: async () => "card-1", isGrabbable: () => true };
    await handleTouchPointerInput(gestures, adapter, {
      type: "down",
      pointerId: 1,
      x: 10,
      y: 10,
      pickX: 10,
      pickY: 10,
      timestamp: 0,
      pointerType: "touch",
    });
    expect(await handleTouchPointerInput(gestures, adapter, {
      type: "move",
      pointerId: 1,
      x: 19,
      y: 10,
      pickX: 19,
      pickY: 10,
      timestamp: 10,
      pointerType: "touch",
    })).toEqual([
      { type: "drag-start", pointerId: 1, entityId: "card-1", x: 19, y: 10 },
      { type: "drag-move", pointerId: 1, entityId: "card-1", x: 19, y: 10 },
    ]);
  });

  test("ignores cancellation after a completed tap so double-tap remains pending", async () => {
    const gestures = new TouchGestureMachine();
    const adapter = { pick: async () => "card-1", isGrabbable: () => true };
    const input = (type: "down" | "up" | "cancel", pointerId: number, timestamp: number) => ({
      type,
      pointerId,
      x: 10,
      y: 10,
      pickX: 10,
      pickY: 10,
      timestamp,
      pointerType: "touch",
    });

    await handleTouchPointerInput(gestures, adapter, input("down", 1, 0));
    expect(await handleTouchPointerInput(gestures, adapter, input("up", 1, 10))).toEqual([]);
    expect(await handleTouchPointerInput(gestures, adapter, input("cancel", 1, 11))).toEqual([]);
    await handleTouchPointerInput(gestures, adapter, input("down", 2, 100));
    expect(await handleTouchPointerInput(gestures, adapter, input("up", 2, 110))).toEqual([
      { type: "double-tap", entityId: "card-1", x: 10, y: 10 },
    ]);
  });

  test("cancels an active dragging pointer", async () => {
    const gestures = new TouchGestureMachine();
    const adapter = { pick: async () => "card-1", isGrabbable: () => true };
    await handleTouchPointerInput(gestures, adapter, {
      type: "down",
      pointerId: 1,
      x: 10,
      y: 10,
      pickX: 10,
      pickY: 10,
      timestamp: 0,
      pointerType: "touch",
    });
    await handleTouchPointerInput(gestures, adapter, {
      type: "move",
      pointerId: 1,
      x: 19,
      y: 10,
      pickX: 19,
      pickY: 10,
      timestamp: 10,
      pointerType: "touch",
    });
    expect(await handleTouchPointerInput(gestures, adapter, {
      type: "cancel",
      pointerId: 1,
      x: 19,
      y: 10,
      pickX: 19,
      pickY: 10,
      timestamp: 11,
      pointerType: "touch",
    })).toEqual([
      { type: "drag-cancel", pointerId: 1, entityId: "card-1" },
    ]);
  });
});

describe("hover picker", () => {
  test("coalesces rapid requests to the latest point and ignores results after disposal", async () => {
    const calls: Array<{ x: number; y: number }> = [];
    const resolvers: Array<(entityId: string | null) => void> = [];
    const results: Array<string | null> = [];
    const hover = createHoverPicker({
      pick: (x, y) => {
        calls.push({ x, y });
        return new Promise((resolve) => resolvers.push(resolve));
      },
    }, (entityId) => results.push(entityId));

    hover.request(1, 2);
    hover.request(3, 4);
    hover.request(5, 6);
    expect(calls).toEqual([{ x: 1, y: 2 }]);

    resolvers[0]?.("piece-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ x: 1, y: 2 }, { x: 5, y: 6 }]);
    expect(results).toEqual(["piece-1"]);

    resolvers[1]?.("piece-2");
    await Promise.resolve();
    expect(results).toEqual(["piece-1", "piece-2"]);

    hover.request(7, 8);
    hover.dispose();
    resolvers[2]?.("piece-3");
    await Promise.resolve();
    expect(results).toEqual(["piece-1", "piece-2"]);
  });
});
