import type { GenerateCoversResponse } from "../api/client";

export const COVER_WIDTH = 336;
export const COVER_HEIGHT = 504;

export type CoverCandidate = GenerateCoversResponse["candidates"][number];
export type CoverPickerPhase = "idle" | "loading" | "ready" | "uploading" | "uploaded" | "failed";

export interface CoverPickerState {
  phase: CoverPickerPhase;
  source: GenerateCoversResponse["source"] | null;
  candidates: CoverCandidate[];
  uploadingIndex: number | null;
  message: string | null;
}

export type CoverPickerEvent =
  | { type: "requested" }
  | { type: "received"; response: GenerateCoversResponse }
  | { type: "pick_requested"; index: number }
  | { type: "pick_succeeded" }
  | { type: "failed"; message: string };

export const initialCoverPickerState: CoverPickerState = {
  phase: "idle",
  source: null,
  candidates: [],
  uploadingIndex: null,
  message: null,
};

export function reduceCoverPicker(state: CoverPickerState, event: CoverPickerEvent): CoverPickerState {
  switch (event.type) {
    case "requested":
      return { ...state, phase: "loading", uploadingIndex: null, message: "Generating four cover options…" };
    case "received":
      return {
        phase: "ready",
        source: event.response.source,
        candidates: [...event.response.candidates],
        uploadingIndex: null,
        message: event.response.source === "procedural" ? "Generated offline with the deterministic cover system." : null,
      };
    case "pick_requested":
      return { ...state, phase: "uploading", uploadingIndex: event.index, message: "Rasterizing and uploading your cover…" };
    case "pick_succeeded":
      return { ...state, phase: "uploaded", uploadingIndex: null, message: "Cover uploaded as a 336 × 504 PNG." };
    case "failed":
      return { ...state, phase: "failed", uploadingIndex: null, message: event.message };
  }
}

export interface CoverRasterPorts {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  loadImage(url: string): Promise<CanvasImageSource>;
  createCanvas(): HTMLCanvasElement;
}

export async function rasterizeCoverSvg(
  svg: string,
  ports: CoverRasterPorts = browserRasterPorts,
): Promise<Blob> {
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = ports.createObjectURL(source);
  try {
    const image = await ports.loadImage(objectUrl);
    const canvas = ports.createCanvas();
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas rendering is unavailable in this browser.");
    context.clearRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
    context.drawImage(image, 0, 0, COVER_WIDTH, COVER_HEIGHT);
    return await canvasPng(canvas);
  } finally {
    ports.revokeObjectURL(objectUrl);
  }
}

export async function rasterizeAndUpload<T>(
  svg: string,
  upload: (png: Blob) => Promise<T>,
  rasterize: (value: string) => Promise<Blob> = rasterizeCoverSvg,
): Promise<T> {
  const png = await rasterize(svg);
  if (png.type !== "image/png") throw new Error("Cover rasterization did not produce a PNG.");
  return upload(png);
}

const browserRasterPorts: CoverRasterPorts = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  loadImage: (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The generated cover preview could not be decoded."));
    image.src = url;
  }),
  createCanvas: () => document.createElement("canvas"),
};

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("The generated cover could not be converted to PNG."));
      else resolve(blob);
    }, "image/png");
  });
}
