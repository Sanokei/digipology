import { expect, test } from "bun:test";
import type { EntityRecord } from "digipology-kernel";
import { pieceFramingBounds, tableCameraFrame, TableFramingController, TABLE_CAMERA_BETA, type TableCameraFrame, type TablePieceBounds } from "./tableCameraFraming";

function fits(frame: TableCameraFrame, pieces: readonly TablePieceBounds[], width: number, height: number): void {
  const sin = Math.sin(TABLE_CAMERA_BETA); const cos = Math.cos(TABLE_CAMERA_BETA); const tan = Math.tan(0.4);
  for (const piece of pieces) for (const x of [piece.x - piece.width / 2, piece.x + piece.width / 2]) {
    for (const z of [piece.z - piece.depth / 2, piece.z + piece.depth / 2]) for (const y of [0, piece.top]) {
      const depth = frame.radius - y * cos + (z - frame.z) * sin;
      const horizontal = (x - frame.x) / (depth * tan * width / height);
      const vertical = (y * sin + (z - frame.z) * cos) / (depth * tan);
      expect(Math.abs(horizontal)).toBeLessThan(1);
      expect(Math.abs(vertical)).toBeLessThan(1);
    }
  }
}

const cards: TablePieceBounds[] = [
  { x: -2.2, z: 0, width: 1.06, depth: 1.52, top: 0.4 },
  { x: 0, z: 0, width: 0.98, depth: 1.4, top: 0.09 },
];

test("narrow initial framing includes the actual deck and played card at readable scale", () => {
  const frame = tableCameraFrame(390, 844, cards);
  expect(frame.x).toBeCloseTo(-1.12, 2);
  expect(frame.radius).toBe(11.8);
  fits(frame, cards, 390, 844);
});

test("a broad board and dice with physical score tokens fit on a phone", () => {
  const dice = [{ x: 0, z: 0, width: 0.8, depth: 0.8, top: 0.8 }, ...[-3, -1, 1, 3].map((x) => ({ x, z: 2, width: 0.76, depth: 0.76, top: 0.18 }))];
  const frame = tableCameraFrame(390, 844, dice);
  expect(frame.radius).toBeGreaterThan(16);
  fits(frame, dice, 390, 844);
  const board = [{ x: 0, z: 0, width: 12, depth: 7.2, top: 0.5 }];
  fits(tableCameraFrame(390, 844, board), board, 390, 844);
});

test("desktop/tablet framing remains familiar and empty/loading frames are finite", () => {
  for (const [width, height] of [[1440, 960], [768, 1024], [0, 0], [390, 844]]) {
    const frame = tableCameraFrame(width!, height!, width === 390 ? [] : cards);
    expect(frame).toEqual({ x: 0, z: 0, radius: 11.8 });
  }
});

test("manual pan/zoom/drag ownership survives scene updates and viewport resize until Reset", () => {
  const controller = new TableFramingController();
  expect(controller.update(1440, 960, cards)).not.toBeNull();
  controller.hold();
  expect(controller.automatic).toBe(false);
  expect(controller.update(390, 844, cards)).toBeNull();
  expect(controller.update(390, 844, [{ ...cards[0]!, x: 3 }])).toBeNull();
  controller.reset();
  expect(controller.update(390, 844, cards)).toEqual(tableCameraFrame(390, 844, cards));
  expect(controller.update(390, 844, cards)).toBeNull();
});

test("logical counters, private hand containers and hidden status cannot pull camera bounds", () => {
  const logical: EntityRecord = { id: "winner", components: { counter: { value: 0, default: 0, min: 0, max: 4 } } };
  expect(pieceFramingBounds(logical)).toBeNull();
  expect(pieceFramingBounds({ id: "status", components: { text: { value: "Your turn" }, transform: { position: { x: 30, y: 0, z: 30 }, scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } } })).toBeNull();
  expect(pieceFramingBounds({ id: "hand", components: { hand: { owner: "seat_1", canonicalOrder: true } } })).toBeNull();
});

test("authored rotation and scale are included in world bounds without changing the entity", () => {
  const entity: EntityRecord = { id: "card", components: { card: { definitionId: "custom", faceUp: false }, transform: { position: { x: -2, y: 0, z: 1 }, scale: { x: 2, y: 1, z: 1 }, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } } } };
  const before = JSON.stringify(entity); const bounds = pieceFramingBounds(entity)!;
  expect(bounds.width).toBeCloseTo(1.4); expect(bounds.depth).toBeCloseTo(1.96);
  expect(bounds.x).toBe(-2); expect(bounds.z).toBe(1);
  expect(JSON.stringify(entity)).toBe(before);
});
