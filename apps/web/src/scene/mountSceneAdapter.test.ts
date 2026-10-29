import { expect, test } from "bun:test";

import { mountSceneAdapter } from "./mountSceneAdapter";
import type { RendererAdapterKind } from "./rendererPolicy";
import type { SceneAdapter } from "./sceneAdapter";

function adapterThat(mount: () => Promise<void>, disposed: string[], name: string): SceneAdapter {
  return {
    handlesDesktopDrag: false,
    mount: async () => mount(),
    dispose: () => disposed.push(name),
    syncEntities: () => undefined,
    pick: async () => null,
    projectToTable: () => null,
    isGrabbable: () => false,
    beginDrag: () => undefined,
    updateDrag: () => undefined,
    rotateDrag: () => undefined,
    flipDrag: () => undefined,
    endDrag: () => undefined,
    cancelDrag: () => undefined,
    setHighlight: () => undefined,
    camera: {
      attach: () => undefined,
      detach: () => undefined,
      orbit: () => undefined,
      pan: () => undefined,
      pinch: () => undefined,
      zoom: () => undefined,
      reset: () => undefined,
    },
    setPaused: () => undefined,
    resize: () => undefined,
    setRenderLoop: () => undefined,
  };
}

test("a Lite mount failure disposes the failed adapter and mounts WebGL", async () => {
  const loaded: RendererAdapterKind[] = [];
  const disposed: string[] = [];
  const fallbacks: unknown[] = [];
  const liteError = new Error("WebGPU adapter unavailable");
  const webgl = adapterThat(async () => undefined, disposed, "webgl");
  const result = await mountSceneAdapter(
    { renderer: "lite", requestedLiteFallback: false, reason: "webgpu" },
    async (renderer) => {
      loaded.push(renderer);
      return renderer === "lite"
        ? adapterThat(async () => { throw liteError; }, disposed, "lite")
        : webgl;
    },
    {} as HTMLCanvasElement,
    "default",
    (error) => fallbacks.push(error),
  );
  expect(result).toBe(webgl);
  expect(loaded).toEqual(["lite", "webgl"]);
  expect(disposed).toEqual(["lite"]);
  expect(fallbacks).toEqual([{ from: "lite", to: "webgl", error: "WebGPU adapter unavailable" }]);
});

test("a WebGL mount failure is surfaced without attempting another adapter", async () => {
  const loaded: RendererAdapterKind[] = [];
  const disposed: string[] = [];
  const error = new Error("WebGL unavailable");
  await expect(mountSceneAdapter(
    { renderer: "webgl", requestedLiteFallback: false, reason: "no-webgpu" },
    async (renderer) => {
      loaded.push(renderer);
      return adapterThat(async () => { throw error; }, disposed, "webgl");
    },
    {} as HTMLCanvasElement,
    "low",
    () => undefined,
  )).rejects.toBe(error);
  expect(loaded).toEqual(["webgl"]);
  expect(disposed).toEqual(["webgl"]);
});

test("a stalled GPU acquisition falls back and cleans up resources that arrive late", async () => {
  const disposed: string[] = [];
  let finishLate: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finishLate = resolve; });
  const lite = adapterThat(() => pending, disposed, "lite");
  const webgl = adapterThat(async () => {}, disposed, "webgl");
  const fallbacks: unknown[] = [];
  const mounted = await mountSceneAdapter(
    { renderer: "lite", requestedLiteFallback: false, reason: "webgpu" },
    async (renderer) => renderer === "lite" ? lite : webgl,
    {} as HTMLCanvasElement, "default", (fallback) => fallbacks.push(fallback), 5,
  );
  expect(mounted).toBe(webgl);
  expect(disposed).toEqual(["lite"]);
  expect(fallbacks).toEqual([{ from: "lite", to: "webgl", error: "Table renderer initialization timed out" }]);
  finishLate();
  await pending;
  await Promise.resolve();
  expect(disposed).toEqual(["lite", "lite"]);
});

test("a stalled fallback renderer is disposed and surfaced instead of leaving an endless loading state", async () => {
  const disposed: string[] = [];
  await expect(mountSceneAdapter(
    { renderer: "lite", requestedLiteFallback: false, reason: "webgpu" },
    async (renderer) => adapterThat(renderer === "lite" ? async () => { throw new Error("No GPU"); } : () => new Promise(() => {}), disposed, renderer),
    {} as HTMLCanvasElement, "low", () => {}, 5,
  )).rejects.toThrow("initialization timed out");
  expect(disposed).toEqual(["lite", "webgl"]);
});

test("a stalled lazy import falls back within the same renderer budget and its late adapter never mounts", async () => {
  let release!: (adapter: SceneAdapter) => void, lateMounts = 0, lateDisposals = 0;
  const stalled = new Promise<SceneAdapter>((resolve) => { release = resolve; });
  const late = { mount: async () => { lateMounts++; }, dispose: () => { lateDisposals++; } } as unknown as SceneAdapter;
  const fallback = { mount: async () => {}, dispose: () => {} } as unknown as SceneAdapter;
  const result = await mountSceneAdapter({ renderer: "lite", requestedLiteFallback: false, reason: "webgpu" }, async (renderer) => renderer === "lite" ? stalled : fallback, {} as HTMLCanvasElement, "default", () => {}, 5);
  expect(result).toBe(fallback); release(late); await Promise.resolve(); await Promise.resolve(); expect(lateMounts).toBe(0); expect(lateDisposals).toBeGreaterThan(0);
});
test("a stalled fallback import rejects instead of leaving the table in perpetual loading", async () => {
  await expect(mountSceneAdapter({ renderer: "lite", requestedLiteFallback: false, reason: "webgpu" }, async () => new Promise<SceneAdapter>(() => {}), {} as HTMLCanvasElement, "default", () => {}, 5)).rejects.toThrow("initialization timed out");
});
