import { describe, expect, test } from "bun:test";
import type { CoverSpec } from "digipology-covers";
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  initialCoverPickerState,
  rasterizeAndUpload,
  rasterizeCoverSvg,
  reduceCoverPicker,
  type CoverRasterPorts,
} from "./coverPickerModel";

const spec: CoverSpec = {
  palette: ["#101820", "#f2aa4c"],
  layout: "banded",
  motif: "cards",
  titleTreatment: "stacked",
  seed: 1,
};

describe("cover picker state", () => {
  test("moves through loading and receives four candidates", () => {
    const loading = reduceCoverPicker(initialCoverPickerState, { type: "requested" });
    expect(loading.phase).toBe("loading");
    const candidates = Array.from({ length: 4 }, (_, index) => ({ spec: { ...spec, seed: index }, svg: `<svg>${index}</svg>` }));
    const ready = reduceCoverPicker(loading, { type: "received", response: { source: "procedural", candidates } });
    expect(ready).toMatchObject({ phase: "ready", source: "procedural", candidates });
    expect(ready.message).toContain("offline");
  });

  test("regenerate replaces the previous candidate set", () => {
    const first = reduceCoverPicker(initialCoverPickerState, {
      type: "received",
      response: { source: "ai", candidates: Array.from({ length: 4 }, (_, seed) => ({ spec: { ...spec, seed }, svg: `old-${seed}` })) },
    });
    const loading = reduceCoverPicker(first, { type: "requested" });
    const secondCandidates = Array.from({ length: 4 }, (_, seed) => ({ spec: { ...spec, seed: seed + 10 }, svg: `new-${seed}` }));
    const second = reduceCoverPicker(loading, { type: "received", response: { source: "ai", candidates: secondCandidates } });
    expect(second.candidates).toEqual(secondCandidates);
    expect(second.candidates.some(({ svg }) => svg.startsWith("old"))).toBe(false);
  });
});

test("pick rasterizes on a 336 x 504 canvas and uploads only a PNG blob", async () => {
  let canvasWidth = 0;
  let canvasHeight = 0;
  let drawn: unknown[] | null = null;
  let revoked = "";
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: () => undefined,
      drawImage: (...values: unknown[]) => { drawn = values; },
    }),
    toBlob: (callback: BlobCallback, type?: string) => {
      canvasWidth = canvas.width;
      canvasHeight = canvas.height;
      callback(new Blob(["png-bytes"], { type: type ?? "" }));
    },
  } as unknown as HTMLCanvasElement;
  const ports: CoverRasterPorts = {
    createObjectURL: (blob) => {
      expect(blob.type).toBe("image/svg+xml;charset=utf-8");
      return "blob:cover";
    },
    revokeObjectURL: (url) => { revoked = url; },
    loadImage: async () => ({}) as CanvasImageSource,
    createCanvas: () => canvas,
  };
  let uploaded: Blob | null = null;
  const result = await rasterizeAndUpload(
    "<svg></svg>",
    async (png) => { uploaded = png; return "uploaded"; },
    (svg) => rasterizeCoverSvg(svg, ports),
  );
  expect(result).toBe("uploaded");
  expect(canvasWidth).toBe(COVER_WIDTH);
  expect(canvasHeight).toBe(COVER_HEIGHT);
  expect(drawn).toHaveLength(5);
  expect(uploaded).toBeInstanceOf(Blob);
  expect((uploaded as Blob | null)?.type).toBe("image/png");
  expect(revoked).toBe("blob:cover");
});
