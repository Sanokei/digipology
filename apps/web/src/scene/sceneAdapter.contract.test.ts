/**
 * The Lite contract below executes the real adapter against a thin engine mock.
 * The WebGL adapter constructs Babylon's DOM/WebGL Engine directly, so it cannot
 * accept a NullEngine without a production refactor; its unchanged interaction
 * logic remains covered by dragBehavior, dragActions, and touchGestures tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createInitialState, type EntityRecord } from "digipology-kernel";

import type { KernelStoreSnapshot } from "../state/kernelStore";
import { handleTouchPointerInput } from "./sceneInteraction";
import type { SceneAdapter } from "./sceneAdapter";
import { TouchGestureMachine, type TouchGestureDecision } from "./touchGestures";

interface FakeVec3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): void;
}

interface FakeQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): void;
}

interface FakeMaterial {
  diffuseColor?: [number, number, number];
  specularColor?: [number, number, number];
  emissiveColor?: [number, number, number];
  diffuseTexture?: object;
  emissiveTexture?: object;
  disableLighting?: boolean;
  specularPower?: number;
}

interface FakeMesh {
  kind: "mesh";
  shape: "box" | "plane";
  name: string;
  position: FakeVec3;
  scaling: FakeVec3;
  rotation: FakeVec3;
  rotationQuaternion: FakeQuaternion;
  metadata?: unknown;
  material?: FakeMaterial;
  pickable: boolean;
  parent: FakeMesh | null;
}

interface FakeCamera {
  kind: "camera";
  alpha: number;
  beta: number;
  radius: number;
  target: FakeVec3;
  fov: number;
  panningSensibility: number;
  wheelPrecision: number;
  inertia: number;
  angularSensibility: number;
  inertialAlphaOffset: number;
  inertialBetaOffset: number;
  inertialRadiusOffset: number;
}

interface FakeEngine {
  canvas: HTMLCanvasElement;
  started: boolean;
  stopped: boolean;
  resized: boolean;
  disposed: boolean;
}

interface FakeScene {
  camera: FakeCamera | null;
  clearColor?: { r: number; g: number; b: number; a: number };
  meshes: FakeMesh[];
  added: object[];
  removed: object[];
  beforeRender: ((deltaMs: number) => void) | null;
  registered: boolean;
  disposed: boolean;
}

interface FakePicker {
  disposed: boolean;
}

interface FakePickOptions {
  filter?: (mesh: FakeMesh) => boolean;
}

const fakeState: {
  engine: FakeEngine | null;
  scene: FakeScene | null;
  picker: FakePicker | null;
  pickMesh: FakeMesh | null;
  createdBoxes: FakeMesh[];
  createdPlanes: FakeMesh[];
  markedMaterials: FakeMaterial[];
  controlAttachListenerCounts: number[];
  controlDetachCount: number;
} = {
  engine: null,
  scene: null,
  picker: null,
  pickMesh: null,
  createdBoxes: [],
  createdPlanes: [],
  markedMaterials: [],
  controlAttachListenerCounts: [],
  controlDetachCount: 0,
};

function vector3(x = 0, y = 0, z = 0): FakeVec3 {
  return {
    x,
    y,
    z,
    set(nextX, nextY, nextZ): void {
      this.x = nextX;
      this.y = nextY;
      this.z = nextZ;
    },
  };
}

function quaternion(): FakeQuaternion {
  return {
    ...vector3(),
    w: 1,
    set(x, y, z, w): void {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
    },
  };
}

function mesh(shape: "box" | "plane"): FakeMesh {
  return {
    kind: "mesh",
    shape,
    name: "",
    position: vector3(),
    scaling: vector3(1, 1, 1),
    rotation: vector3(),
    rotationQuaternion: quaternion(),
    pickable: true,
    parent: null,
  };
}

function resetFakeState(): void {
  fakeState.engine = null;
  fakeState.scene = null;
  fakeState.picker = null;
  fakeState.pickMesh = null;
  fakeState.createdBoxes = [];
  fakeState.createdPlanes = [];
  fakeState.markedMaterials = [];
  fakeState.controlAttachListenerCounts = [];
  fakeState.controlDetachCount = 0;
}

class FakeCanvas {
  readonly clientWidth = 100;
  readonly clientHeight = 100;
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

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
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
}

mock.module("@babylonjs/lite", () => ({
  createEngine: async (canvas: HTMLCanvasElement): Promise<FakeEngine> => {
    const engine = { canvas, started: false, stopped: false, resized: false, disposed: false };
    fakeState.engine = engine;
    return engine;
  },
  createSceneContext: (): FakeScene => {
    const scene: FakeScene = {
      camera: null,
      meshes: [],
      added: [],
      removed: [],
      beforeRender: null,
      registered: false,
      disposed: false,
    };
    fakeState.scene = scene;
    return scene;
  },
  createArcRotateCamera: (alpha: number, beta: number, radius: number, target: FakeVec3): FakeCamera => ({
    kind: "camera",
    alpha,
    beta,
    radius,
    target: vector3(target.x, target.y, target.z),
    fov: 0.8,
    panningSensibility: 0,
    wheelPrecision: 0,
    inertia: 0,
    angularSensibility: 0,
    inertialAlphaOffset: 0,
    inertialBetaOffset: 0,
    inertialRadiusOffset: 0,
  }),
  attachControl: (_camera: FakeCamera, canvas: HTMLCanvasElement): (() => void) => {
    const count = "listenerCount" in canvas
      ? (canvas as HTMLCanvasElement & { listenerCount(type: string): number }).listenerCount("touchstart")
      : -1;
    fakeState.controlAttachListenerCounts.push(count);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      fakeState.controlDetachCount += 1;
    };
  },
  setCameraLimits: (): (() => void) => () => undefined,
  createBox: (): FakeMesh => {
    const result = mesh("box");
    fakeState.createdBoxes.push(result);
    return result;
  },
  createPlane: (): FakeMesh => {
    const result = mesh("plane");
    fakeState.createdPlanes.push(result);
    return result;
  },
  createStandardMaterial: (): FakeMaterial => ({}),
  createDynamicTexture: (): object => ({}),
  updateDynamicTexture: (): void => undefined,
  createGpuPicker: (): FakePicker => {
    const picker = { disposed: false };
    fakeState.picker = picker;
    return picker;
  },
  pickAsync: async (_picker: FakePicker, _x: number, _y: number, options?: FakePickOptions) => {
    const pickedMesh = fakeState.pickMesh;
    const hit = pickedMesh !== null && (options?.filter?.(pickedMesh) ?? true);
    return { hit, pickedMesh: hit ? pickedMesh : null };
  },
  disposePicker: (picker: FakePicker): void => {
    picker.disposed = true;
  },
  createHemisphericLight: () => ({ kind: "light", diffuseColor: [0, 0, 0], groundColor: [0, 0, 0] }),
  createDirectionalLight: () => ({ kind: "light", position: vector3(), diffuse: [0, 0, 0] }),
  addToScene: (scene: FakeScene, entity: object): void => {
    scene.added.push(entity);
    if ((entity as { kind?: unknown }).kind === "mesh") scene.meshes.push(entity as FakeMesh);
  },
  removeFromScene: (scene: FakeScene, entity: object): void => {
    scene.removed.push(entity);
    const index = scene.meshes.indexOf(entity as FakeMesh);
    if (index >= 0) scene.meshes.splice(index, 1);
  },
  setParent: (child: FakeMesh, parent: FakeMesh | null): void => {
    child.parent = parent;
  },
  markMaterialUboDirty: (material: FakeMaterial): void => {
    fakeState.markedMaterials.push(material);
  },
  onBeforeRender: (scene: FakeScene, callback: (deltaMs: number) => void): void => {
    scene.beforeRender = callback;
  },
  registerScene: async (scene: FakeScene): Promise<void> => {
    scene.registered = true;
  },
  startEngine: async (engine: FakeEngine): Promise<void> => {
    engine.started = true;
    engine.stopped = false;
  },
  stopEngine: (engine: FakeEngine): void => {
    engine.stopped = true;
  },
  resizeEngine: (engine: FakeEngine): void => {
    engine.resized = true;
  },
  disposeScene: (scene: FakeScene): void => {
    scene.disposed = true;
  },
  disposeEngine: (engine: FakeEngine): void => {
    engine.disposed = true;
  },
}));

const { createLiteSceneAdapter } = await import("./liteSceneAdapter");

const originalDocument = globalThis.document;

beforeAll(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => null,
      }),
    },
  });
});

afterAll(() => {
  if (originalDocument === undefined) Reflect.deleteProperty(globalThis, "document");
  else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

beforeEach(resetFakeState);

function transform(x: number, z = 2) {
  return {
    position: { x, y: 0.2, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 2, y: 1, z: 2 },
  };
}

function card(x = 1, faceUp = true): EntityRecord {
  return {
    id: "card-1",
    components: {
      card: { definitionId: "card", faceUp },
      grabbable: { enabled: true, heldBy: null },
      transform: transform(x),
    },
  };
}

function die(): EntityRecord {
  return {
    id: "die-1",
    components: {
      die: { definitionId: "d6", value: 4 },
      transform: transform(-1),
    },
  };
}

function counter(): EntityRecord {
  return {
    id: "counter-1",
    components: {
      counter: { value: 7, default: 0, min: null, max: null },
      transform: transform(0, -2),
    },
  };
}

function snapshot(
  entities: Record<string, EntityRecord>,
  correction: KernelStoreSnapshot["correction"] = null,
): KernelStoreSnapshot {
  const state = createInitialState({
    releaseId: "contract-release",
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    entities,
  });
  return {
    state,
    displayedState: state,
    events: [],
    players: [],
    pendingRequestIds: new Set(),
    predictionLedger: [],
    correction,
    endedReason: null,
    stateHash: null,
    diagnostic: null,
    definitions: { card: { label: "Contract Card", color: "#abcdef" } },
    gameTitle: null,
  };
}

function pieceMesh(entityId: string): FakeMesh {
  const result = fakeState.scene?.meshes.find((candidate) =>
    (candidate.metadata as { entityId?: unknown } | undefined)?.entityId === entityId
  );
  if (result === undefined) throw new Error(`Missing fake mesh for ${entityId}`);
  return result;
}

async function mountAdapter(sendAction?: (action: { type: string; payload: unknown }) => unknown) {
  const canvas = new FakeCanvas();
  const adapter = createLiteSceneAdapter(sendAction === undefined ? {} : { sendAction });
  await adapter.mount(canvas as unknown as HTMLCanvasElement, { tier: "default" });
  return { adapter, canvas };
}

function applyDecisions(adapter: SceneAdapter, decisions: readonly TouchGestureDecision[]): void {
  for (const decision of decisions) {
    if (decision.type === "drag-start") {
      adapter.beginDrag(decision.entityId, decision.pointerId, decision.x, decision.y);
    } else if (decision.type === "drag-move") {
      adapter.updateDrag(decision.pointerId, decision.x, decision.y);
    } else if (decision.type === "drag-end") {
      adapter.updateDrag(decision.pointerId, decision.x, decision.y);
      adapter.endDrag(decision.pointerId);
    }
  }
}

describe("real Lite SceneAdapter contract through a thin engine mock", () => {
  test("creates, updates, recreates, removes, and picks real adapter pieces", async () => {
    const { adapter } = await mountAdapter(() => undefined);
    adapter.syncEntities(snapshot({ "card-1": card(), "die-1": die(), "counter-1": counter() }));

    const initialCard = pieceMesh("card-1");
    const initialDie = pieceMesh("die-1");
    const initialCounter = pieceMesh("counter-1");
    for (const piece of [initialCard, initialDie, initialCounter]) {
      const label = fakeState.createdPlanes.find((candidate) => candidate.parent === piece);
      expect(label?.name).toBe(`${piece.name}-label-plane`);
    }

    adapter.syncEntities(snapshot({ "card-1": card(3), "die-1": die(), "counter-1": counter() }));
    expect(pieceMesh("card-1")).toBe(initialCard);
    expect(initialCard.position.x).toBe(3);

    adapter.syncEntities(snapshot({ "card-1": card(3, false), "die-1": die(), "counter-1": counter() }));
    const flippedCard = pieceMesh("card-1");
    expect(flippedCard).not.toBe(initialCard);
    expect(fakeState.scene?.removed).toContain(initialCard);

    fakeState.pickMesh = flippedCard;
    expect(await adapter.pick(12, 18)).toBe("card-1");
    fakeState.pickMesh = null;
    expect(await adapter.pick(12, 18)).toBeNull();
    fakeState.pickMesh = fakeState.createdBoxes.find((candidate) => candidate.name === "table-surface") ?? null;
    expect(await adapter.pick(12, 18)).toBeNull();

    adapter.syncEntities(snapshot({ "card-1": card(3, false) }));
    expect(fakeState.scene?.removed).toContain(initialDie);
    expect(fakeState.scene?.removed).toContain(initialCounter);
    expect(() => pieceMesh("die-1")).toThrow();
    adapter.dispose();
  });

  test("routes touch drag through the real adapter with canonical grab/drop payloads", async () => {
    const actions: Array<{ type: string; payload: unknown }> = [];
    const { adapter, canvas } = await mountAdapter((action) => actions.push(action));
    adapter.syncEntities(snapshot({ "card-1": card() }));
    fakeState.pickMesh = pieceMesh("card-1");
    const gestures = new TouchGestureMachine();

    applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
      type: "down", pointerId: 4, x: 50, y: 50, pickX: 50, pickY: 50,
      timestamp: 0, pointerType: "touch",
    }));
    applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
      type: "move", pointerId: 4, x: 60, y: 50, pickX: 60, pickY: 50,
      timestamp: 10, pointerType: "touch",
    }));
    applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
      type: "up", pointerId: 4, x: 65, y: 50, pickX: 65, pickY: 50,
      timestamp: 20, pointerType: "touch",
    }));

    expect(actions).toEqual([
      { type: "entity.grab", payload: { entityId: "card-1" } },
      {
        type: "entity.drop",
        payload: {
          entityId: "card-1",
          transform: {
            position: { x: expect.any(Number), y: 0.045, z: expect.any(Number) },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 2, y: 1, z: 2 },
          },
        },
      },
    ]);
    expect(canvas.hasPointerCapture(4)).toBeFalse();
    expect(fakeState.controlAttachListenerCounts.every((count) => count === 1)).toBeTrue();
    adapter.dispose();
  });

  test("does not expose grabbability or begin a drag without sendAction", async () => {
    const { adapter, canvas } = await mountAdapter();
    adapter.syncEntities(snapshot({ "card-1": card() }));
    const piece = pieceMesh("card-1");
    const originalY = piece.position.y;

    expect(adapter.isGrabbable("card-1")).toBeFalse();
    adapter.beginDrag("card-1", 9, 50, 50);
    expect(canvas.hasPointerCapture(9)).toBeFalse();
    expect(piece.position.y).toBe(originalY);
    adapter.dispose();
  });

  test("updates emissive highlights and restores black when cleared", async () => {
    const { adapter } = await mountAdapter(() => undefined);
    adapter.syncEntities(snapshot({ "card-1": card() }));
    const material = pieceMesh("card-1").material;
    if (material === undefined) throw new Error("Piece material was not assigned");
    fakeState.markedMaterials = [];

    adapter.setHighlight("card-1", "hover");
    expect(material.emissiveColor).toEqual([0.18, 0.12, 0.04]);
    adapter.setHighlight("card-1", "selected");
    expect(material.emissiveColor).toEqual([0.23, 0.16, 0.05]);
    adapter.setHighlight("card-1", "held");
    expect(material.emissiveColor).toEqual([0.42, 0.34, 0.13]);
    adapter.setHighlight(null, "held");
    adapter.setHighlight(null, "selected");
    adapter.setHighlight(null, "hover");
    expect(material.emissiveColor).toEqual([0, 0, 0]);
    expect(fakeState.markedMaterials).toHaveLength(6);
    adapter.dispose();
  });

  test("eases corrections to the target over 180 ms", async () => {
    const { adapter } = await mountAdapter(() => undefined);
    adapter.syncEntities(snapshot({ "card-1": card(0) }));
    const piece = pieceMesh("card-1");
    adapter.syncEntities(snapshot(
      { "card-1": card(6) },
      { id: 1, entityId: "card-1", message: "corrected" },
    ));

    expect(piece.position.x).toBe(0);
    fakeState.scene?.beforeRender?.(90);
    expect(piece.position.x).toBeGreaterThan(0);
    expect(piece.position.x).toBeLessThan(6);
    fakeState.scene?.beforeRender?.(90);
    expect(piece.position.x).toBe(6);
    adapter.dispose();
  });

  test("disposes controls, picker, engine, scene, and adapter pieces", async () => {
    const { adapter, canvas } = await mountAdapter(() => undefined);
    adapter.syncEntities(snapshot({ "card-1": card() }));
    const engine = fakeState.engine;
    const scene = fakeState.scene;
    const picker = fakeState.picker;

    expect(canvas.listenerCount("touchstart")).toBe(1);
    expect(canvas.listenerCount("touchmove")).toBe(1);
    expect(canvas.listenerCount("touchend")).toBe(1);
    expect(canvas.listenerCount("touchcancel")).toBe(1);
    adapter.dispose();

    expect(engine?.stopped).toBeTrue();
    expect(engine?.disposed).toBeTrue();
    expect(scene?.disposed).toBeTrue();
    expect(picker?.disposed).toBeTrue();
    expect(adapter.isGrabbable("card-1")).toBeFalse();
    expect(canvas.listenerCount("touchstart")).toBe(0);
    expect(canvas.listenerCount("touchmove")).toBe(0);
    expect(canvas.listenerCount("touchend")).toBe(0);
    expect(canvas.listenerCount("touchcancel")).toBe(0);
  });
});
