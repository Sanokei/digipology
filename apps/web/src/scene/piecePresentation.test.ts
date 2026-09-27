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
  expect(seatColor("runner_seat_2_a")).toBe("#d94b4b");
  const counter = piecePresentation(entity("score_seat_2", {
    counter: { value: 2, default: 0, min: 0, max: 5 },
  }));
  const runner = piecePresentation(entity("runner_seat_2_a", {
    grabbable: { enabled: true, heldBy: null }, tags: { values: ["runner"] },
  }));
  expect(counter).toMatchObject({ shape: "cylinder", color: "#d94b4b", label: "2" });
  expect(runner).toMatchObject({ shape: "cylinder", color: "#d94b4b", label: "" });
});

test("signatures include presentation-changing snap occupancy", () => {
  const open = entity("slot", { "snap-point": { radius: 1, capacity: 1, attached: [], tags: [], alignment: null } });
  const filled = entity("slot", { "snap-point": { radius: 1, capacity: 1, attached: ["pawn"], tags: [], alignment: null } });
  expect(piecePresentationSignature(open)).toBe("snap:0");
  expect(piecePresentationSignature(filled)).toBe("snap:1");
});

test("appearance definitions override shape, size, tint, and flippable face safely", () => {
  const piece = entity("custom", {
    appearance: { definitionId: "settlement", seat: "seat_10" },
    flippable: { flipped: true },
    grabbable: { enabled: true, heldBy: null },
  });
  const back = { background: "#332211" as const, elements: [] };
  const presentation = piecePresentation(piece, {
    shape: "meeple", size: { w: 1.2, d: 0.4, h: 1.4 }, color: "#ffffff", backColor: "#000000",
    label: "Front", backLabel: "Back", seatTint: true, back,
  });
  expect(presentation).toMatchObject({ shape: "meeple", width: 1.2, depth: 0.4, height: 1.4, color: "#8a6545", label: "Back", face: back });
  expect(piecePresentationSignature(piece, { shape: "meeple", back })).toContain("face-v1-");
});

test("legacy objects gain semantic geometry without requiring appearance definitions", () => {
  expect(piecePresentation(entity("card", { card: { definitionId: "missing", faceUp: true } }))).toMatchObject({ shape: "card", width: 0.86, depth: 1.22, height: 0.09, materialKind: "card-stock" });
  expect(piecePresentation(entity("die", { die: { definitionId: "missing", value: 6 } }))).toMatchObject({ shape: "cube", width: 0.72, depth: 0.72, height: 0.72, materialKind: "plastic" });
});

test("face-down cards never select front art or front presentation fields", () => {
  const front = { background: "#ffffff" as const, elements: [] };
  const back = { background: "#111111" as const, elements: [] };
  const hidden = piecePresentation(entity("hidden", { card: { definitionId: "secret", faceUp: false } }), {
    label: "Secret Queen", color: "#abcdef", face: front, backLabel: "Card back", backColor: "#123456", back,
  });
  expect(hidden).toMatchObject({ label: "Card back", color: "#123456", face: back });
  expect(hidden.face).not.toBe(front);
});
