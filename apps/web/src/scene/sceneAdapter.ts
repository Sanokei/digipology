import type { KernelStoreSnapshot } from "../state/kernelStore";
import type { RendererTier } from "./rendererPolicy";
import type { SceneAudio } from "./sceneAudio";

export type HighlightKind = "hover" | "selected" | "held" | "locked";

export type TableStyle = "felt-green" | "dark-wood" | "slate" | "parchment";

export interface PresentationSettings {
  readonly reducedMotion: boolean;
  readonly reducedAudio: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly tableStyle: TableStyle;
}

export interface PresentationSettingsSource {
  getSnapshot(): PresentationSettings;
  subscribe(listener: (settings: PresentationSettings) => void): () => void;
}

export interface ScenePose {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation?: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  readonly scale?: { readonly x: number; readonly y: number; readonly z: number };
}

export interface ScenePerformanceStats {
  readonly fps: number;
  readonly visiblePieces: number;
  readonly textureCount: number;
}

export interface SceneAdapterMountOptions {
  tier: RendererTier;
}

export interface SceneAdapter {
  readonly handlesDesktopDrag: boolean;
  mount(canvas: HTMLCanvasElement, options: SceneAdapterMountOptions): Promise<void>;
  dispose(): void;
  syncEntities(view: KernelStoreSnapshot): void;
  pick(x: number, y: number): Promise<string | null>;
  projectToTable(x: number, y: number): { x: number; y: number; z: number } | null;
  projectFromTable(point: { x: number; y: number; z: number }): { x: number; y: number } | null;
  isGrabbable(entityId: string): boolean;
  beginDrag(entityId: string, pointerId: number, x: number, y: number): void;
  updateDrag(pointerId: number, x: number, y: number): void;
  rotateDrag(radians: number): void;
  flipDrag(): void;
  endDrag(pointerId: number): void;
  cancelDrag(pointerId: number): void;
  setHighlight(entityId: string | null, kind: HighlightKind): void;
  /** Replaces the local multi-selection without touching canonical state. */
  setSelection(ids: readonly string[]): void;
  /** Shows one transient interaction preview; a later call replaces it. */
  showSnapGhost(entityId: string, pose: ScenePose): void;
  clearSnapGhost(): void;
  getPerformanceStats(): ScenePerformanceStats;
  camera: {
    attach(): void;
    detach(): void;
    orbit(dx: number, dy: number): void;
    pan(dx: number, dy: number): void;
    pinch(previousDistance: number, distance: number): void;
    zoom(deltaY: number, cursorX?: number, cursorY?: number): void;
    reset(seatIndex?: number): void;
    toggleTopDown(): void;
  };
  setPaused(paused: boolean): void;
  resize(): void;
  setRenderLoop(running: boolean): void;
}

export interface SceneAdapterDependencies {
  sendAction?: ((action: { type: string; payload: unknown }) => unknown) | undefined;
  settings?: PresentationSettingsSource | undefined;
  audio?: SceneAudio | undefined;
}

export type SceneAdapterFactory = (dependencies: SceneAdapterDependencies) => SceneAdapter;
