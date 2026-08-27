import { expect, test } from "bun:test";
import type { EntityRecord } from "digipology-kernel";
import { piecePresentation, piecePresentationSignature, seatColor } from "./piecePresentation";

function entity(id: string, components: EntityRecord["components"]): EntityRecord {
  return { id, components };
}

test("semantic tabletop objects get distinct silhouettes and restrained materials", () => {
  const zone = piecePresentation(entity("zone", {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 8, y: 2, z: 4 } },
    zone: { shape: "box", acceptedTags: [], visibleInPlay: true },
  }));
  const snap = piecePresentation(entity("slot_1", {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    "snap-point": { radius: 0.75, capacity: 1, attached: [], tags: [], alignment: null },
  }));
  expect(zone).toMatchObject({ shape: "box", height: 0.028, alpha: 0.16, label: "" });
  expect(snap).toMatchObject({ shape: "ring", height: 0.08, label: "" });
});

test("seat-owned counters and runners share a stable palette", () => {
  expect(seatColor("runner_seat_2_a")).toBe("#42b8ef");
  const counter = piecePresentation(entity("score_seat_2", {
    counter: { value: 2, default: 0, min: 0, max: 5 },
  }));
  const runner = piecePresentation(entity("runner_seat_2_a", {
    grabbable: { enabled: true, heldBy: null }, tags: { values: ["runner"] },
  }));
  expect(counter).toMatchObject({ shape: "cylinder", color: "#42b8ef", label: "2" });
  expect(runner).toMatchObject({ shape: "cylinder", color: "#42b8ef", label: "" });
});

test("signatures include presentation-changing snap occupancy", () => {
  const open = entity("slot", { "snap-point": { radius: 1, capacity: 1, attached: [], tags: [], alignment: null } });
  const filled = entity("slot", { "snap-point": { radius: 1, capacity: 1, attached: ["pawn"], tags: [], alignment: null } });
  expect(piecePresentationSignature(open)).toBe("snap:0");
  expect(piecePresentationSignature(filled)).toBe("snap:1");
});
