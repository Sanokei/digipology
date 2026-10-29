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


test("leaving during a lazy import cancels without creating a fallback or mounting the late adapter", async () => {
  const owner = new AbortController(), disposed: string[] = [], loaded: string[] = [];
  let release!: (adapter: SceneAdapter) => void, mounts = 0;
  const pending = new Promise<SceneAdapter>((resolve) => { release = resolve; });
  const mounting = mountSceneAdapter({ renderer: "lite", requestedLiteFallback: false, reason: "webgpu" }, async (renderer) => { loaded.push(renderer); return pending; }, {} as HTMLCanvasElement, "low", () => {}, 100, owner.signal);
  owner.abort(); await expect(mounting).rejects.toThrow("cancelled");
  const late = adapterThat(async () => { mounts++; }, disposed, "late"); release(late);
  await Promise.resolve(); await Promise.resolve();
  expect(loaded).toEqual(["lite"]); expect(mounts).toBe(0); expect(disposed).toContain("late");
});

test("a timed-out initialization is aborted and isolated from the fallback canvas even if its GPU work finishes late", async () => {
  const canvases = [{} as HTMLCanvasElement, {} as HTMLCanvasElement], disposed: string[] = [];
  let release!: () => void, lateSignal: AbortSignal | undefined, usedCanvas: HTMLCanvasElement | undefined, index = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const late = { ...adapterThat(async () => {}, disposed, "late"), mount: async (canvas: HTMLCanvasElement, options: { signal?: AbortSignal }) => { usedCanvas = canvas; lateSignal = options.signal; await pending; } };
  const fallback = adapterThat(async () => {}, disposed, "fallback");
  expect(await mountSceneAdapter({ renderer: "lite", requestedLiteFallback: false, reason: "webgpu" }, async (kind) => kind === "lite" ? late : fallback, () => canvases[index++]!, "default", () => {}, 5)).toBe(fallback);
  expect(usedCanvas).toBe(canvases[0]); expect(index).toBe(2); expect(lateSignal?.aborted).toBe(true);
  release(); await pending; await Promise.resolve(); expect(disposed.filter((name) => name === "late").length).toBeGreaterThanOrEqual(2); expect(disposed).not.toContain("fallback");
});
