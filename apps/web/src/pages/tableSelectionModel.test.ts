import { expect, test } from "bun:test";
import type { CanonicalGameState } from "digipology-kernel";
import { boxSelectionIds, nearestCompatibleSnap, reconcileSelection, toggleSelection } from "./tableSelectionModel";

const transform = (x: number, z: number) => ({ position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
const state = {
  entities: {
    a: { id: "a", components: { transform: transform(2, 3), grabbable: { enabled: true, heldBy: null } } },
    b: { id: "b", components: { transform: transform(8, 9), grabbable: { enabled: true, heldBy: null } } },
    hidden: { id: "hidden", components: { transform: transform(3, 3), grabbable: { enabled: true, heldBy: null } } },
    bag: { id: "bag", components: { transform: transform(20, 20), grabbable: { enabled: true, heldBy: null }, container: { items: ["hidden"], capacity: null, ordering: "top", visibility: "public" } } },
  },
} as unknown as CanonicalGameState;

test("box selection is direction independent and excludes contained objects", () => {
  const project = (point: { x: number; z: number }) => ({ x: point.x * 10, y: point.z * 10 });
  expect(boxSelectionIds(state, { start: { x: 90, y: 100 }, end: { x: 10, y: 20 } }, project)).toEqual(["a", "b"]);
});

test("selection toggles and reconciles in stable ID order", () => {
  expect(toggleSelection(["b"], "a")).toEqual(["a", "b"]);
  expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  expect(reconcileSelection(["missing", "b", "a"], state)).toEqual(["a", "b"]);
});

test("snap preview chooses the nearest compatible point with a stable ID tie-break", () => {
  const snapping = structuredClone(state);
  snapping.entities.a!.components.tags = { values: ["card"] };
  snapping.entities.snap_b = { id: "snap_b", components: { transform: transform(2, 3), "snap-point": { radius: 2, capacity: 1, tags: ["card"], alignment: {} } } };
  snapping.entities.snap_a = { id: "snap_a", components: { transform: transform(2, 3), "snap-point": { radius: 2, capacity: 1, tags: ["card"], alignment: {} } } };
  expect(nearestCompatibleSnap(snapping, "a", { x: 2, y: 0, z: 3 })).toBe("snap_a");
});
