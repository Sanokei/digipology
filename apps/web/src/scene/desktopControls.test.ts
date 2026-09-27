import { describe, expect, test } from "bun:test";
import { DesktopControlMachine } from "./desktopControls";

describe("Tabletop Simulator-style desktop controls", () => {
  test("an async LMB pick claims the current pointer position and drops on release", () => {
    const controls = new DesktopControlMachine();
    controls.down({ pointerId: 1, button: 0, x: 10, y: 20 });
    expect(controls.move(1, 16, 24)).toEqual([]);
    expect(controls.claimObject(1, "pawn")).toEqual([
      { type: "object-select", entityId: "pawn", toggle: false },
      { type: "object-start", pointerId: 1, entityId: "pawn", x: 16, y: 24, wholeDeck: false },
    ]);
    expect(controls.move(1, 30, 40)).toEqual([
      { type: "object-move", pointerId: 1, entityId: "pawn", x: 30, y: 40 },
    ]);
    expect(controls.up(1, 31, 42)).toEqual([
      { type: "object-drop", pointerId: 1, entityId: "pawn", x: 31, y: 42 },
    ]);
  });

  test("RMB drag orbits while a stationary RMB click requests context", () => {
    const controls = new DesktopControlMachine();
    controls.down({ pointerId: 2, button: 2, x: 50, y: 50 });
    expect(controls.move(2, 64, 44)).toEqual([{ type: "camera-orbit", deltaX: 14, deltaY: -6 }]);
    expect(controls.up(2, 64, 44)).toEqual([]);

    controls.down({ pointerId: 3, button: 2, x: 70, y: 80 });
    expect(controls.move(3, 73, 82)).toEqual([]);
    expect(controls.up(3, 72, 82)).toEqual([{ type: "context", x: 72, y: 82 }]);
  });

  test("MMB pans and cancel rolls an active object gesture back", () => {
    const controls = new DesktopControlMachine();
    controls.down({ pointerId: 4, button: 1, x: 100, y: 100 });
    expect(controls.move(4, 90, 115)).toEqual([{ type: "camera-pan", deltaX: -10, deltaY: 15 }]);

    controls.down({ pointerId: 5, button: 0, x: 20, y: 20 });
    controls.claimObject(5, "card");
    expect(controls.cancel(5)).toEqual([{ type: "object-cancel", pointerId: 5, entityId: "card" }]);
    expect(controls.activeObject()).toBeNull();
  });

  test("an empty LMB drag produces a box selection even when the pick resolves late", () => {
    const controls = new DesktopControlMachine();
    controls.down({ pointerId: 6, button: 0, x: 10, y: 20, toggleSelection: true });
    controls.move(6, 40, 60);
    expect(controls.claimEmpty(6)).toEqual([
      { type: "box-start", pointerId: 6, x: 10, y: 20 },
      { type: "box-move", pointerId: 6, startX: 10, startY: 20, x: 40, y: 60 },
    ]);
    expect(controls.up(6, 50, 70)).toEqual([
      { type: "box-end", pointerId: 6, startX: 10, startY: 20, x: 50, y: 70, toggle: true },
    ]);
  });
});
