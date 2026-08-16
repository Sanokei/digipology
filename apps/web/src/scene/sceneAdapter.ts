import type { KernelStoreSnapshot } from "../state/kernelStore";
import type { RendererTier } from "./rendererPolicy";

export type HighlightKind = "hover" | "selected" | "held";

export interface SceneAdapterMountOptions {
  tier: RendererTier;
}

export interface SceneAdapter {
  readonly handlesDesktopDrag: boolean;
  mount(canvas: HTMLCanvasElement, options: SceneAdapterMountOptions): Promise<void>;
  dispose(): void;
  syncEntities(view: KernelStoreSnapshot): void;
  pick(x: number, y: number): Promise<string | null>;
  isGrabbable(entityId: string): boolean;
  beginDrag(entityId: string, pointerId: number, x: number, y: number): void;
  updateDrag(pointerId: number, x: number, y: number): void;
  endDrag(pointerId: number): void;
  cancelDrag(pointerId: number): void;
  setHighlight(entityId: string | null, kind: HighlightKind): void;
  camera: {
    attach(): void;
    detach(): void;
    pan(dx: number, dy: number): void;
    pinch(previousDistance: number, distance: number): void;
  };
  setPaused(paused: boolean): void;
  resize(): void;
  setRenderLoop(running: boolean): void;
}

export interface SceneAdapterDependencies {
  sendAction?: ((action: { type: string; payload: unknown }) => unknown) | undefined;
}

export type SceneAdapterFactory = (dependencies: SceneAdapterDependencies) => SceneAdapter;
