import { expect, test } from "bun:test";
import type { EntityRecord } from "digipology-kernel";
import { cardArtwork, dieArtworkFaces, type PieceArtwork } from "./pieceArtwork";
import { drawPieceArtwork } from "./pieceArtworkCanvas";
import { piecePresentation, piecePresentationSignature, pieceSurfaceLayout } from "./piecePresentation";

function card(faceUp: boolean): EntityRecord {
  return { id: "private-card", components: { card: { definitionId: "standard_v2_hearts_7", faceUp } } };
}

test("a face-down surface contains no authored identity, label or color on either side", () => {
  const entity = card(false);
  const definition = { label: "Seven secret plans", color: "#ff0066" };
  const surfaces = pieceSurfaceLayout(entity, piecePresentation(entity, definition), definition);
  expect(surfaces.map((surface) => surface.artwork)).toEqual([{ kind: "card-back" }, { kind: "card-back" }]);
  expect(piecePresentation(entity, definition).label).toBe("Face-down card");
  expect(JSON.stringify(surfaces)).not.toContain("secret");
  expect(JSON.stringify(surfaces)).not.toContain("hearts");
  expect(JSON.stringify(surfaces)).not.toContain("ff0066");
});

test("standard faces require both the explicitly authored identity and the matching label", () => {
  expect(cardArtwork(card(true), { label: "7 of Hearts", color: "#bd352d" })).toEqual({ kind: "standard-card", identity: { rank: "7", suit: "hearts" } });
  expect(cardArtwork(card(true), { label: "Lucky seven", color: "#76a032" })).toEqual({ kind: "custom-card", label: "Lucky seven", accent: "#76a032" });
  const custom = { id: "custom", components: { card: { definitionId: "custom-hearts", faceUp: true } } };
  expect(cardArtwork(custom, { label: "7 of Hearts" }).kind).toBe("custom-card");
  const flipped = card(true); flipped.components.flippable = { flipped: false };
  expect(cardArtwork(flipped, { label: "7 of Hearts" })).toEqual({ kind: "card-back" });
});

test("a rendered standard die shows the actual result on top and physically consistent opposite faces", () => {
  for (let value = 1; value <= 6; value++) {
    const faces = dieArtworkFaces({ id: "die", components: { die: { definitionId: "standard_d6", value } } });
    expect(faces[0]).toEqual({ kind: "die-face", value, pips: true });
    const values = faces.map((face) => face.kind === "die-face" ? Number(face.value) : 0);
    expect([...values].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(values[0]! + values[1]!).toBe(7);
    expect(values[2]! + values[3]!).toBe(7);
    expect(values[4]! + values[5]!).toBe(7);
  }
});

test("custom dice preserve their authored result rather than acquiring invented pips", () => {
  for (const value of ["sun", "1", 1, 20]) {
    const faces = dieArtworkFaces({ id: "weather", components: { die: { definitionId: "weather", value, faces: ["sun", "rain", 1, 20] } } });
    expect(faces).toHaveLength(6);
    expect(faces.every((face) => face.kind === "die-face" && face.value === value && !face.pips)).toBe(true);
  }
  expect(dieArtworkFaces({ id: "custom", components: { die: { definitionId: "weather", value: 1 } } })[0]).toEqual({ kind: "die-face", value: 1, pips: false });
});

test("an empty deck is a thin empty placeholder and never displays fictional paper layers", () => {
  const empty: EntityRecord = { id: "deck", components: { deck: { enabled: true }, container: { items: [], capacity: 52, ordering: "stack", visibility: "public" } } };
  const appearance = piecePresentation(empty);
  expect(appearance.height).toBeLessThan(0.05);
  const surfaces = pieceSurfaceLayout(empty, appearance);
  expect(surfaces).toHaveLength(2);
  expect(surfaces[0]?.artwork).toEqual({ kind: "card-back", count: 0, enabled: true });
  const full: EntityRecord = { ...empty, components: { ...empty.components, container: { ...empty.components.container!, items: ["one", "two", "three"] } } };
  expect(pieceSurfaceLayout(full, piecePresentation(full)).filter((surface) => surface.artwork.kind === "paper-edge")).toHaveLength(4);
});

test("the face-list changes the renderer signature even when the current die value is unchanged", () => {
  const standard: EntityRecord = { id: "die", components: { die: { definitionId: "die", value: 1, faces: [1, 2, 3, 4, 5, 6] } } };
  const custom: EntityRecord = { id: "die", components: { die: { definitionId: "die", value: 1, faces: [1, "rain"] } } };
  expect(piecePresentationSignature(standard)).not.toBe(piecePresentationSignature(custom));
});

function drawingRecorder(): { context: CanvasRenderingContext2D; text: string[]; circles: number[]; scales: number[][]; rectangles: number[][] } {
  const text: string[] = []; const circles: number[] = [];
  const scales: number[][] = []; const rectangles: number[][] = [];
  const target: Record<string, unknown> = {
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    fillText: (value: string) => text.push(value), measureText: (value: string) => ({ width: value.length * 25 }),
    arc: (_x: number, _y: number, radius: number, start: number, end: number) => { if (end - start > 6) circles.push(radius); },
    scale: (...values: number[]) => scales.push(values), fillRect: (...values: number[]) => rectangles.push(values),
  };
  return { context: new Proxy(target, { get: (object, key) => object[String(key)] ?? (() => undefined) }) as unknown as CanvasRenderingContext2D, text, circles, scales, rectangles };
}

test("raster artwork paints the correct number of card suits and die pips", () => {
  const seven = drawingRecorder();
  drawPieceArtwork(seven.context, 512, 736, { kind: "standard-card", identity: { rank: "7", suit: "hearts" } });
  expect(seven.text.filter((text) => text === "♥")).toHaveLength(9); // seven pips + two corner suits
  expect(seven.text.filter((text) => text === "7")).toHaveLength(2);
  for (let value = 1; value <= 6; value++) {
    const recording = drawingRecorder();
    drawPieceArtwork(recording.context, 256, 256, { kind: "die-face", value, pips: true });
    expect(recording.circles).toHaveLength(value);
    expect(recording.rectangles).toHaveLength(0); // transparent ink over the rounded body
  }
  const custom = drawingRecorder();
  drawPieceArtwork(custom.context, 256, 256, { kind: "die-face", value: "sun", pips: false });
  expect(custom.text).toEqual(["sun"]); expect(custom.circles).toHaveLength(0);
});

test("a power-of-two resized WebGL texture retains the full card layout instead of clustering pips at the top", () => {
  const recording = drawingRecorder();
  drawPieceArtwork(recording.context, 512, 1024, { kind: "standard-card", identity: { rank: "7", suit: "diamonds" } });
  expect(recording.scales).toEqual([[1, 1024 / 736]]);
  expect(recording.text.filter((text) => text === "♦")).toHaveLength(9);
});

test("all artwork variants can be painted with browser Canvas2D operations", () => {
  const variants: PieceArtwork[] = [
    { kind: "card-back", count: 52 }, { kind: "card-back", count: 0 }, { kind: "custom-card", label: "A longer authored card title", accent: "#2c615a" },
    { kind: "standard-card", identity: { rank: "K", suit: "spades" } }, { kind: "standard-card", identity: { rank: "A", suit: "diamonds" } },
    { kind: "paper-edge", count: 3 }, { kind: "felt" }, { kind: "wood" }, { kind: "contact-shadow" },
  ];
  for (const variant of variants) expect(() => drawPieceArtwork(drawingRecorder().context, 512, 736, variant)).not.toThrow();
});
