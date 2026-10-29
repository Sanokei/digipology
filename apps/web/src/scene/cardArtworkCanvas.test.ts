import { expect, test } from "bun:test";
import { cardStockProfile } from "./cardStock";
import { containCardBackImage, drawPieceArtwork } from "./pieceArtworkCanvas";

test("game back images retain the whole source and aspect ratio inside portrait or landscape windows", () => {
  const window = { x: 18, y: 18, width: 476, height: 580 };
  for (const [width, height] of [[1024, 1536], [1600, 900], [512, 736]]) {
    const contained = containCardBackImage(width!, height!, window);
    expect(contained.x).toBeGreaterThanOrEqual(window.x - 1e-8);
    expect(contained.y).toBeGreaterThanOrEqual(window.y - 1e-8);
    expect(contained.x + contained.width).toBeLessThanOrEqual(window.x + window.width + 1e-8);
    expect(contained.y + contained.height).toBeLessThanOrEqual(window.y + window.height + 1e-8);
    expect(contained.width / contained.height).toBeCloseTo(width! / height!, 8);
  }
});

function recorder() {
  const text: string[] = []; const images: unknown[][] = []; const clips: unknown[][] = []; let latestPath: unknown[] = [];
  const target: Record<string, unknown> = {
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (value: string) => ({ width: value.length * 10 }),
    roundRect: (...values: unknown[]) => { latestPath = values; }, clip: () => clips.push(latestPath),
    drawImage: (...values: unknown[]) => images.push(values), fillText: (value: string) => text.push(value),
  };
  const context = new Proxy(target, { get: (object, key) => object[String(key)] ?? (() => undefined) }) as unknown as CanvasRenderingContext2D;
  return { context, text, images, clips };
}

test("concealed bitmap backs use the stock mask and carry no count or generic monogram", () => {
  const image = { width: 1024, height: 1536 } as unknown as CanvasImageSource;
  const shape = cardStockProfile(0.98, 0.012, 1.4).paperShape;
  const drawing = recorder();
  drawPieceArtwork(drawing.context, 512, 1024, { kind: "card-back", gameTitle: "First Deal" }, { paperShape: shape, backImage: image });
  expect(drawing.images).toHaveLength(1);
  expect(drawing.images[0]?.[0]).toBe(image);
  expect(drawing.images[0]).toHaveLength(5); // whole image; no source-crop rectangle
  expect(drawing.text).toEqual(["First Deal"]);
  expect(drawing.clips[0]).toEqual([0, 0, 512, 736, { x: 512 * shape.radiusX, y: 736 * shape.radiusY }]);
});

test("every nonempty pile and loose card share the same image window and public title", () => {
  const image = { width: 1024, height: 1536 } as unknown as CanvasImageSource;
  const bounds: unknown[][] = [];
  for (const count of [52, 1, undefined]) {
    const drawing = recorder();
    drawPieceArtwork(drawing.context, 512, 736, { kind: "card-back", gameTitle: "First Deal", ...(count === undefined ? {} : { count }), enabled: true }, { backImage: image });
    const rect = drawing.images[0]!;
    expect(rect[0]).toBe(image);
    bounds.push(rect);
    expect(drawing.text).toEqual(["First Deal"]);
  }
  expect(bounds[0]).toEqual(bounds[1]); expect(bounds[1]).toEqual(bounds[2]);
  const empty = recorder();
  drawPieceArtwork(empty.context, 512, 736, { kind: "card-back", gameTitle: "First Deal", count: 0 }, { backImage: image });
  expect(empty.images[0]).toEqual(bounds[0]);
  expect(empty.text).toEqual(["First Deal", "EMPTY"]);
});
