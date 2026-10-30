/**
 * The shared contract executes the real WebGL adapter and real attachDragBehavior
 * against Babylon's NullEngine. Only browser-owned construction surfaces are injected.
 */
import { beforeEach, expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { CreatePickingRayToRef } from "@babylonjs/core/Culling/ray.core";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

import type { HighlightLayerFacade } from "./dragBehavior";
import { runSceneAdapterContract } from "./sceneAdapter.contract.shared";
import { createWebglSceneAdapter } from "./webglSceneAdapter";

class ContractCanvas {
  readonly clientWidth = 100;
  readonly clientHeight = 100;
  width = 100;
  height = 100;
  tabIndex = 0;
  style = { cursor: "default" };
  private readonly listeners = new Map<string, EventListenerOrEventListenerObject[]>();
  private readonly capturedPointers = new Set<number>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type);
    if (listeners === undefined) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  focus(): void {}

  listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.length;
    return count;
  }
}

function mediaQuery(): MediaQueryList {
  return {
    matches: true,
    media: "",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  };
}

let highlighted = new Set<Mesh>();

beforeEach(() => {
  highlighted = new Set();
});

test.each([
  { renderer: "ANGLE (Google, Vulkan SwiftShader Device (Subzero))", software: true },
  { renderer: "llvmpipe (LLVM 15.0, 256 bits)", software: true },
  { renderer: "AMD Radeon RX 6800", software: false },
])("WebGL keeps the table graph while adapting costly effects for $renderer", async ({ renderer, software }) => {
  const canvas = new ContractCanvas();
  Object.defineProperties(canvas, { clientWidth: { value: 1440, configurable: true }, clientHeight: { value: 960, configurable: true } });
  const engine = new NullEngine({ renderWidth: 100, renderHeight: 100, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 4, renderingCanvas: canvas as unknown as HTMLCanvasElement });
  // NullEngine intentionally ignores framebuffer scaling; record the real
  // adapter's browser-engine requests. Rendered browser cases check pixels.
  const scales: number[] = [];
  engine.setHardwareScalingLevel = (scale) => { scales.push(scale); };
  engine.getGlInfo = () => ({ renderer, vendor: "test driver", version: "WebGL 2.0" });
  const adapter = createWebglSceneAdapter({
    createEngine: () => engine,
    createHighlightLayer: () => ({ addMesh: () => {}, removeMesh: () => {}, dispose: () => {} }),
    matchMedia: () => mediaQuery(), devicePixelRatio: () => 2,
  });
  try {
    await adapter.mount(canvas as unknown as HTMLCanvasElement, { tier: "default" });
    expect(engine.scenes[0]?.activeCamera).not.toBeNull();
    expect(engine.scenes[0]?.meshes.length).toBeGreaterThan(0);
    expect(engine.scenes[0]?.getLightByName("key-light")?.getShadowGenerator() !== null).toBe(!software);
    expect(engine.maxFPS).toBe(software ? 30 : undefined);
    if (software) expect(canvas.clientWidth * canvas.clientHeight / scales.at(-1)! ** 2).toBeCloseTo(600_000);
    else expect(scales.at(-1)).toBe(0.5);
    Object.defineProperties(canvas, { clientWidth: { value: 390 }, clientHeight: { value: 300 } });
    adapter.resize(); expect(scales.at(-1)).toBe(0.5);
  } finally { adapter.dispose(); }
  expect(engine.isDisposed).toBe(true);
});

runSceneAdapterContract({
  name: "webgl",
  handlesDesktopDrag: false,
  supportedHighlights: ["hover", "selected", "held", "locked"],
  async mount(sendAction) {
    const canvas = new ContractCanvas();
    let engine: NullEngine | null = null;
    let scene: Scene | null = null;
    let deltaMs = 0;
    let engineDisposed = false;
    let sceneDisposed = false;
    let cameraAttached = 0;
    let cameraDetached = 0;
    let pickedEntityId: string | null = null;
    const createHighlightLayer = (): HighlightLayerFacade => {
      const layerMeshes = new Set<Mesh>();
      return {
        addMesh(mesh: Mesh, _color: Color3) {
          layerMeshes.add(mesh);
          highlighted.add(mesh);
        },
        removeMesh(mesh: Mesh) {
          layerMeshes.delete(mesh);
          highlighted.delete(mesh);
        },
        dispose() {
          for (const mesh of layerMeshes) highlighted.delete(mesh);
          layerMeshes.clear();
        },
      };
    };
    const adapter = createWebglSceneAdapter({
      ...(sendAction === undefined ? {} : { sendAction }),
      createEngine: (_canvas) => {
        const created = new NullEngine({
          renderWidth: 100,
          renderHeight: 100,
          textureSize: 256,
          deterministicLockstep: false,
          lockstepMaxSteps: 4,
          renderingCanvas: _canvas,
        });
        created.getDeltaTime = () => deltaMs;
        const dispose = created.dispose.bind(created);
        created.dispose = () => {
          engineDisposed = true;
          dispose();
        };
        engine = created;
        return created;
      },
      createLabelTexture: () => ({
        hasAlpha: false,
        drawText: () => undefined,
        dispose: () => undefined,
      }) as unknown as DynamicTexture,
      createHighlightLayer,
      matchMedia: () => mediaQuery(),
      devicePixelRatio: () => 1,
    });
    await adapter.mount(canvas as unknown as HTMLCanvasElement, { tier: "low" });
    const mountedEngine = engine as NullEngine | null;
    if (mountedEngine === null) throw new Error("NullEngine was not created");
    scene = mountedEngine.scenes[0] ?? null;
    if (scene === null) throw new Error("WebGL scene was not created");
    const mountedScene = scene;
    const disposeScene = mountedScene.dispose.bind(mountedScene);
    mountedScene.dispose = () => {
      sceneDisposed = true;
      disposeScene();
    };
    mountedScene.pick = ((_x: number, _y: number, predicate?: (mesh: Mesh) => boolean) => {
      const pickedMesh = pickedEntityId === null
        ? null
        : mountedScene.meshes.find((mesh) => (
          (mesh.metadata as { entityId?: unknown } | null)?.entityId === pickedEntityId
          && (predicate?.(mesh as Mesh) ?? true)
        )) ?? null;
      return { pickedMesh };
    }) as unknown as Scene["pick"];
    const createPickingRayToRef: Scene["createPickingRayToRef"] = (x, y, world, ray, camera, cameraViewSpace, distant) => (
      CreatePickingRayToRef(mountedScene, x, y, world, ray, camera ?? mountedScene.activeCamera, cameraViewSpace, distant)
    );
    mountedScene.createPickingRayToRef = createPickingRayToRef;
    const camera = mountedScene.activeCamera;
    if (camera === null) throw new Error("WebGL camera was not created");
    const attachCamera = camera.attachControl.bind(camera);
    camera.attachControl = ((...args: Parameters<typeof camera.attachControl>) => {
      cameraAttached += 1;
      return attachCamera(...args);
    }) as typeof camera.attachControl;
    const detachCamera = camera.detachControl.bind(camera);
    camera.detachControl = (() => {
      cameraDetached += 1;
      return detachCamera();
    }) as typeof camera.detachControl;

    const entityMesh = (entityId: string): Mesh | null => (mountedScene.meshes.find((mesh) => (
      (mesh.metadata as { entityId?: unknown } | null)?.entityId === entityId
    )) as Mesh | undefined) ?? null;

    return {
      adapter,
      hasPointerCapture: (pointerId) => canvas.hasPointerCapture(pointerId),
      piece(entityId) {
        const value = entityMesh(entityId);
        return value === null ? null : {
          identity: value,
          get x() { return value.position.x; },
          get y() { return value.position.y; },
          get label() { return typeof (value.metadata as { displayLabel?: unknown } | null)?.displayLabel === "string" ? (value.metadata as { displayLabel: string }).displayLabel : null; },
          get disposed() { return value.isDisposed(); },
        };
      },
      setPick(entityId) {
        pickedEntityId = entityId;
      },
      tick(nextDeltaMs) {
        deltaMs = nextDeltaMs;
        mountedScene.onBeforeRenderObservable.notifyObservers(mountedScene);
      },
      highlight(entityId) {
        const mesh = entityMesh(entityId);
        return mesh !== null && highlighted.has(mesh);
      },
      cameraCounts: () => ({ attached: cameraAttached, detached: cameraDetached }),
      livePieceCount: () => mountedScene.meshes.filter((mesh) => (
        typeof (mesh.metadata as { entityId?: unknown } | null)?.entityId === "string"
      )).length,
      listenerCount: () => canvas.listenerCount(),
      disposed: () => engineDisposed && sceneDisposed,
    };
  },
});
