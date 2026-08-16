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
    isGrabbable: () => false,
    beginDrag: () => undefined,
    updateDrag: () => undefined,
    endDrag: () => undefined,
    cancelDrag: () => undefined,
    setHighlight: () => undefined,
    camera: { attach: () => undefined, detach: () => undefined, pan: () => undefined, pinch: () => undefined },
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
    { renderer: "lite", requestedLiteFallback: false },
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
  expect(fallbacks).toEqual([liteError]);
});

test("a WebGL mount failure is surfaced without attempting another adapter", async () => {
  const loaded: RendererAdapterKind[] = [];
  const disposed: string[] = [];
  const error = new Error("WebGL unavailable");
  await expect(mountSceneAdapter(
    { renderer: "webgl", requestedLiteFallback: false },
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

