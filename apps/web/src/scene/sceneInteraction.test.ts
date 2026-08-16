import { describe, expect, test } from "bun:test";

import { handleTouchPointerInput } from "./sceneInteraction";
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
});
