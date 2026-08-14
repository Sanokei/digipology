import { expect, test } from "bun:test";

import { createDragActionCallbacks } from "./dragActions";

test("shared desktop and touch drag callbacks preserve grab/drop payloads", () => {
  const actions: Array<{ type: string; payload: unknown }> = [];
  const callbacks = createDragActionCallbacks(
    "pawn-1",
    (action) => actions.push(action),
    () => ({
      rotation: { x: 0, y: 0.5, z: 0, w: 0.5 },
      scale: { x: 2, y: 1, z: 2 },
    }),
    () => true,
  );
  callbacks.onGrab();
  callbacks.onDrop({ x: 3, y: 0.2, z: -2 });
  expect(actions).toEqual([
    { type: "entity.grab", payload: { entityId: "pawn-1" } },
    {
      type: "entity.drop",
      payload: {
        entityId: "pawn-1",
        transform: {
          position: { x: 3, y: 0.2, z: -2 },
          rotation: { x: 0, y: 0.5, z: 0, w: 0.5 },
          scale: { x: 2, y: 1, z: 2 },
        },
      },
    },
  ]);
});

test("shared drag callbacks suppress canonical actions while paused", () => {
  const actions: unknown[] = [];
  const callbacks = createDragActionCallbacks("pawn-1", (action) => actions.push(action), () => undefined, () => false);
  callbacks.onGrab();
  callbacks.onDrop({ x: 0, y: 0, z: 0 });
  expect(actions).toEqual([]);
});
