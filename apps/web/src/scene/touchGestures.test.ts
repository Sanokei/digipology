import { describe, expect, it } from "bun:test";

import { TouchGestureMachine, type NormalizedPointerEvent, type TouchGestureDecision } from "./touchGestures";

const piece = { entityId: "card-1", grabbable: true };

function event(
  type: NormalizedPointerEvent["type"],
  timestamp: number,
  overrides: Partial<NormalizedPointerEvent> = {},
): NormalizedPointerEvent {
  return {
    type,
    pointerId: 1,
    x: 10,
    y: 20,
    timestamp,
    pointerType: "touch",
    target: piece,
    ...overrides,
  };
}

describe("TouchGestureMachine single-touch arbitration", () => {
  it("keeps movement at the slop boundary as a tap and starts drag just beyond it", () => {
    const tap = new TouchGestureMachine({ tapSlop: 8, doubleTapMs: 300 });
    tap.handle(event("down", 0));
    expect(tap.handle(event("move", 20, { x: 18 }))).toEqual([]);
    expect(tap.handle(event("up", 40, { x: 18 }))).toEqual([]);
    expect(tap.advance(340)).toEqual([{ type: "tap", entityId: "card-1", x: 18, y: 20 }]);

    const drag = new TouchGestureMachine({ tapSlop: 8 });
    drag.handle(event("down", 0));
    expect(drag.handle(event("move", 20, { x: 18.01 }))).toEqual([
      { type: "drag-start", pointerId: 1, entityId: "card-1", x: 18.01, y: 20 },
      { type: "drag-move", pointerId: 1, entityId: "card-1", x: 18.01, y: 20 },
    ]);
    expect(drag.handle(event("up", 30, { x: 19 }))).toEqual([
      { type: "drag-end", pointerId: 1, entityId: "card-1", x: 19, y: 20 },
    ]);
  });

  it("does not turn a one-finger move on empty table into camera movement", () => {
    const machine = new TouchGestureMachine();
    machine.handle(event("down", 0, { target: null }));
    expect(machine.handle(event("move", 30, { x: 40, target: null }))).toEqual([]);
    expect(machine.handle(event("up", 50, { x: 40, target: null }))).toEqual([]);
    expect(machine.nextDeadline()).toBeNull();
  });

  it("distinguishes a delayed tap from a double tap within the window", () => {
    const single = new TouchGestureMachine({ doubleTapMs: 300 });
    single.handle(event("down", 0));
    single.handle(event("up", 40));
    expect(single.advance(339)).toEqual([]);
    expect(single.advance(340)).toEqual([{ type: "tap", entityId: "card-1", x: 10, y: 20 }]);

    const double = new TouchGestureMachine({ doubleTapMs: 300 });
    double.handle(event("down", 0));
    double.handle(event("up", 40));
    double.handle(event("down", 200));
    expect(double.handle(event("up", 260))).toEqual([
      { type: "double-tap", entityId: "card-1", x: 10, y: 20 },
    ]);
    expect(double.advance(1_000)).toEqual([]);
  });

  it("flushes a prior tap when the next tap targets another entity", () => {
    const machine = new TouchGestureMachine();
    machine.handle(event("down", 0));
    machine.handle(event("up", 30));
    machine.handle(event("down", 100, { target: { entityId: "card-2", grabbable: true } }));
    expect(machine.handle(event("up", 130, { target: { entityId: "card-2", grabbable: true } }))).toEqual([
      { type: "tap", entityId: "card-1", x: 10, y: 20 },
    ]);
  });
});

describe("TouchGestureMachine long press", () => {
  it("fires at 450 ms and only once", () => {
    const machine = new TouchGestureMachine({ longPressMs: 450 });
    machine.handle(event("down", 100));
    expect(machine.advance(549)).toEqual([]);
    expect(machine.advance(550)).toEqual([
      { type: "long-press", entityId: "card-1", x: 10, y: 20 },
    ]);
    expect(machine.advance(900)).toEqual([]);
    expect(machine.handle(event("up", 910))).toEqual([]);
  });

  it("is cancelled by movement beyond slop", () => {
    const machine = new TouchGestureMachine({ tapSlop: 8, longPressMs: 450 });
    machine.handle(event("down", 0));
    machine.handle(event("move", 200, { x: 18.01 }));
    expect(machine.advance(450)).toEqual([]);
  });

  it("is cancelled by a second finger", () => {
    const machine = new TouchGestureMachine({ longPressMs: 450 });
    machine.handle(event("down", 0));
    expect(machine.handle(event("down", 200, { pointerId: 2, x: 40 }))).toEqual([{ type: "camera-start" }]);
    expect(machine.advance(450)).toEqual([]);
  });

  it("does not fire after an up before the threshold", () => {
    const machine = new TouchGestureMachine({ longPressMs: 450 });
    machine.handle(event("down", 0));
    machine.handle(event("up", 449));
    expect(machine.advance(450)).toEqual([]);
    expect(machine.advance(749)).toEqual([{ type: "tap", entityId: "card-1", x: 10, y: 20 }]);
  });
});

describe("TouchGestureMachine multi-touch arbitration", () => {
  it("cancels an active object drag when the second finger arrives", () => {
    const machine = new TouchGestureMachine({ tapSlop: 8 });
    machine.handle(event("down", 0));
    machine.handle(event("move", 20, { x: 30 }));
    expect(machine.handle(event("down", 30, { pointerId: 2, x: 80 }))).toEqual([
      { type: "drag-cancel", pointerId: 1, entityId: "card-1" },
      { type: "camera-start" },
    ]);
  });

  it("classifies changing separation as pinch and parallel motion as pan", () => {
    const pinch = new TouchGestureMachine({ pinchSlop: 8 });
    pinch.handle(event("down", 0, { x: 0, y: 0 }));
    pinch.handle(event("down", 1, { pointerId: 2, x: 100, y: 0 }));
    expect(pinch.handle(event("move", 2, { pointerId: 2, x: 109, y: 0 }))).toEqual([
      { type: "camera-pinch", previousDistance: 100, distance: 109 },
    ]);

    const pan = new TouchGestureMachine({ tapSlop: 8, pinchSlop: 8 });
    pan.handle(event("down", 0, { x: 0, y: 0 }));
    pan.handle(event("down", 1, { pointerId: 2, x: 100, y: 0 }));
    expect(pan.handle(event("move", 2, { x: 20, y: 0 }))).toEqual([]);
    expect(pan.handle(event("move", 3, { pointerId: 2, x: 120, y: 0 }))).toEqual([
      { type: "camera-pan", deltaX: 20, deltaY: 0 },
    ]);
  });
});

describe("TouchGestureMachine cancellation cleanup", () => {
  it("cleans up idle, dragging, pending-tap, and multi-touch states", () => {
    const cases: Array<{ setup(machine: TouchGestureMachine): void; expected: TouchGestureDecision[] }> = [
      { setup: (machine) => { machine.handle(event("down", 0)); }, expected: [] },
      {
        setup: (machine) => {
          machine.handle(event("down", 0));
          machine.handle(event("move", 10, { x: 30 }));
        },
        expected: [{ type: "drag-cancel", pointerId: 1, entityId: "card-1" }],
      },
      {
        setup: (machine) => {
          machine.handle(event("down", 0));
          machine.handle(event("up", 10));
        },
        expected: [],
      },
      {
        setup: (machine) => {
          machine.handle(event("down", 0));
          machine.handle(event("down", 10, { pointerId: 2, x: 50 }));
        },
        expected: [{ type: "camera-end" }],
      },
    ];

    for (const testCase of cases) {
      const machine = new TouchGestureMachine();
      testCase.setup(machine);
      expect(machine.handle(event("cancel", 100))).toEqual(testCase.expected);
      expect(machine.nextDeadline()).toBeNull();
      expect(machine.advance(1_000)).toEqual([]);
    }
  });

  it("treats lost-capture abort equivalently from the public abort path", () => {
    const machine = new TouchGestureMachine();
    machine.handle(event("down", 0));
    machine.handle(event("move", 10, { x: 30 }));
    expect(machine.abort()).toEqual([{ type: "drag-cancel", pointerId: 1, entityId: "card-1" }]);
    expect(machine.abort()).toEqual([]);
  });

  it("ignores non-touch pointer input", () => {
    const machine = new TouchGestureMachine();
    expect(machine.handle(event("down", 0, { pointerType: "mouse" }))).toEqual([]);
    expect(machine.nextDeadline()).toBeNull();
  });
});
