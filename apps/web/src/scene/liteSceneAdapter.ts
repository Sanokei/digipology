import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createDirectionalLight,
  createDynamicTexture,
  createEngine,
  createGpuPicker,
  createHemisphericLight,
  createPlane,
  createSceneContext,
  createStandardMaterial,
  disposeEngine,
  disposePicker,
  disposeScene,
  markMaterialUboDirty,
  onBeforeRender,
  pickAsync,
  registerScene,
  removeFromScene,
  resizeEngine,
  setCameraLimits,
  setParent,
  startEngine,
  stopEngine,
  updateDynamicTexture,
  type ArcRotateCamera,
  type DynamicTexture2D,
  type EngineContext,
  type GpuPicker,
  type Mesh,
  type SceneContext,
  type StandardMaterialProps,
  type Vec3,
} from "@babylonjs/lite";
import type { EntityRecord, TransformComponent } from "digipology-kernel";

import type { KernelStoreSnapshot } from "../state/kernelStore";
import { createDragActionCallbacks } from "./dragActions";
import { intersectRayWithHorizontalPlaneToRef, type MutableVector3Like } from "./dragPlane";
import type {
  HighlightKind,
  SceneAdapter,
  SceneAdapterDependencies,
  SceneAdapterMountOptions,
} from "./sceneAdapter";
import { TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH } from "./tableDimensions";

interface DragBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  restingY: number;
}

interface CorrectionAnimation {
  elapsed: number;
  fromPosition: [number, number, number];
  fromScaling: [number, number, number];
  fromRotation: [number, number, number, number];
  toPosition: [number, number, number];
  toScaling: [number, number, number];
  toRotation: [number, number, number, number];
}

interface PieceGraph {
  mesh: Mesh;
  material: StandardMaterialProps;
  signature: string;
  transformSignature: string;
  restingY: number;
  grabbable: boolean;
  bounds?: DragBounds;
  labelMesh?: Mesh;
  labelTexture?: DynamicTexture2D;
  lastCorrectionId?: number;
  correction?: CorrectionAnimation;
}

const LIFT_HEIGHT = 0.22;
const HIGHLIGHT_COLORS: Record<HighlightKind, [number, number, number]> = {
  hover: [0.18, 0.12, 0.04],
  selected: [0.23, 0.16, 0.05],
  held: [0.42, 0.34, 0.13],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function hexColor(value: string, fallback: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const source = match?.[1] ?? /^#?([0-9a-f]{6})$/i.exec(fallback)?.[1] ?? "d7b26d";
  return [
    Number.parseInt(source.slice(0, 2), 16) / 255,
    Number.parseInt(source.slice(2, 4), 16) / 255,
    Number.parseInt(source.slice(4, 6), 16) / 255,
  ];
}

function cardFaceUp(entity: EntityRecord): boolean {
  const { card, flippable } = entity.components;
  return flippable?.flipped ?? card?.faceUp ?? false;
}

function displaySignature(entity: EntityRecord): string {
  const { card, die, counter } = entity.components;
  if (card !== undefined) return `card:${card.definitionId}:${cardFaceUp(entity)}`;
  if (die !== undefined) return `die:${String(die.value)}`;
  if (counter !== undefined) return `counter:${counter.value}`;
  return "other";
}

function transformSignature(transform: TransformComponent | undefined, restingY: number): string {
  if (transform === undefined) return `default:0:${restingY}:0:0:0:0:1:1:1:1`;
  const { position, rotation, scale } = transform;
  return `${position.x}:${position.y}:${position.z}:${rotation.x}:${rotation.y}:${rotation.z}:${rotation.w}:${scale.x}:${scale.y}:${scale.z}`;
}

function transformTarget(
  transform: TransformComponent | undefined,
  restingY: number,
): {
  position: [number, number, number];
  scaling: [number, number, number];
  rotation: [number, number, number, number];
} {
  return transform === undefined
    ? { position: [0, restingY, 0], scaling: [1, 1, 1], rotation: [0, 0, 0, 1] }
    : {
        position: [transform.position.x, transform.position.y, transform.position.z],
        scaling: [transform.scale.x, transform.scale.y, transform.scale.z],
        rotation: [transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w],
      };
}

function applyTransform(mesh: Mesh, transform: TransformComponent | undefined, restingY: number): void {
  const target = transformTarget(transform, restingY);
  mesh.position.set(...target.position);
  mesh.scaling.set(...target.scaling);
  mesh.rotationQuaternion.set(...target.rotation);
}

function normalize(vector: MutableVector3Like): MutableVector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length > 0) {
    vector.x /= length;
    vector.y /= length;
    vector.z /= length;
  }
  return vector;
}

function cross(a: Vec3, b: Vec3): MutableVector3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function createScreenRay(
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): { origin: MutableVector3Like; direction: MutableVector3Like } | null {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return null;
  const sinBeta = Math.sin(camera.beta);
  const origin = {
    x: camera.target.x + camera.radius * Math.cos(camera.alpha) * sinBeta,
    y: camera.target.y + camera.radius * Math.cos(camera.beta),
    z: camera.target.z + camera.radius * Math.sin(camera.alpha) * sinBeta,
  };
  const forward = normalize({
    x: camera.target.x - origin.x,
    y: camera.target.y - origin.y,
    z: camera.target.z - origin.z,
  });
  const right = normalize(cross({ x: 0, y: 1, z: 0 }, forward));
  const up = normalize(cross(forward, right));
  const halfHeight = Math.tan(camera.fov / 2);
  const screenX = (x / width) * 2 - 1;
  const screenY = 1 - (y / height) * 2;
  const direction = normalize({
    x: forward.x + right.x * screenX * halfHeight * (width / height) + up.x * screenY * halfHeight,
    y: forward.y + right.y * screenX * halfHeight * (width / height) + up.y * screenY * halfHeight,
    z: forward.z + right.z * screenX * halfHeight * (width / height) + up.z * screenY * halfHeight,
  });
  return { origin, direction };
}

function startCorrection(
  piece: PieceGraph,
  transform: TransformComponent | undefined,
): void {
  const target = transformTarget(transform, piece.restingY);
  piece.correction = {
    elapsed: 0,
    fromPosition: [piece.mesh.position.x, piece.mesh.position.y, piece.mesh.position.z],
    fromScaling: [piece.mesh.scaling.x, piece.mesh.scaling.y, piece.mesh.scaling.z],
    fromRotation: [
      piece.mesh.rotationQuaternion.x,
      piece.mesh.rotationQuaternion.y,
      piece.mesh.rotationQuaternion.z,
      piece.mesh.rotationQuaternion.w,
    ],
    toPosition: target.position,
    toScaling: target.scaling,
    toRotation: target.rotation,
  };
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function updateCorrection(piece: PieceGraph, deltaMs: number): void {
  const correction = piece.correction;
  if (correction === undefined) return;
  correction.elapsed += deltaMs;
  const linear = Math.min(correction.elapsed / 180, 1);
  const eased = 1 - (1 - linear) ** 3;
  piece.mesh.position.set(
    mix(correction.fromPosition[0], correction.toPosition[0], eased),
    mix(correction.fromPosition[1], correction.toPosition[1], eased),
    mix(correction.fromPosition[2], correction.toPosition[2], eased),
  );
  piece.mesh.scaling.set(
    mix(correction.fromScaling[0], correction.toScaling[0], eased),
    mix(correction.fromScaling[1], correction.toScaling[1], eased),
    mix(correction.fromScaling[2], correction.toScaling[2], eased),
  );
  const qx = mix(correction.fromRotation[0], correction.toRotation[0], eased);
  const qy = mix(correction.fromRotation[1], correction.toRotation[1], eased);
  const qz = mix(correction.fromRotation[2], correction.toRotation[2], eased);
  const qw = mix(correction.fromRotation[3], correction.toRotation[3], eased);
  const length = Math.hypot(qx, qy, qz, qw) || 1;
  piece.mesh.rotationQuaternion.set(qx / length, qy / length, qz / length, qw / length);
  if (linear === 1) delete piece.correction;
}

function makeLabelCanvas(text: string): HTMLCanvasElement {
  const label = document.createElement("canvas");
  label.width = 512;
  label.height = 256;
  const context = label.getContext("2d");
  if (context !== null) {
    context.clearRect(0, 0, label.width, label.height);
    context.fillStyle = "#dce8d8";
    context.fillRect(0, 0, label.width, label.height);
    context.fillStyle = "#102018";
    context.font = "bold 54px Manrope, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text.slice(0, 28), label.width / 2, label.height / 2, label.width - 24);
  }
  return label;
}

export function createLiteSceneAdapter(dependencies: SceneAdapterDependencies): SceneAdapter {
  let canvas: HTMLCanvasElement | null = null;
  let engine: EngineContext | null = null;
  let scene: SceneContext | null = null;
  let cameraGraph: ArcRotateCamera | null = null;
  let picker: GpuPicker | null = null;
  let detachCameraControl: (() => void) | null = null;
  let detachCameraLimits: (() => void) | null = null;
  let paused = false;
  let rendering = false;
  let pickPending = false;
  let currentView: KernelStoreSnapshot | null = null;
  let lastDisplayedState: KernelStoreSnapshot["displayedState"] = null;
  let lastDefinitions: KernelStoreSnapshot["definitions"] | null = null;
  let lastCorrectionId: number | null = null;
  let activeDrag: {
    entityId: string;
    pointerId: number;
    callbacks: ReturnType<typeof createDragActionCallbacks>;
  } | null = null;
  const highlights: Record<HighlightKind, string | null> = { hover: null, selected: null, held: null };
  const pieces = new Map<string, PieceGraph>();

  function requireMounted() {
    if (canvas === null || engine === null || scene === null || cameraGraph === null) {
      throw new Error("Babylon-Lite scene adapter is not mounted");
    }
    return { canvas, engine, scene, camera: cameraGraph };
  }

  function applyPieceHighlight(piece: PieceGraph): void {
    let color: [number, number, number] = [0, 0, 0];
    for (const kind of ["hover", "selected", "held"] as const) {
      const entityId = (piece.mesh.metadata as { entityId?: unknown } | undefined)?.entityId;
      if (highlights[kind] === entityId) color = HIGHLIGHT_COLORS[kind];
    }
    piece.material.emissiveColor = color;
    markMaterialUboDirty(piece.material);
  }

  function destroyPiece(piece: PieceGraph): void {
    if (scene === null) return;
    if (piece.labelMesh !== undefined) removeFromScene(scene, piece.labelMesh);
    removeFromScene(scene, piece.mesh);
  }

  function makeMaterial(color: string): StandardMaterialProps {
    const result = createStandardMaterial();
    result.diffuseColor = hexColor(color, "#d7b26d");
    result.specularColor = hexColor("#271d10", "#271d10");
    result.specularPower = 18;
    return result;
  }

  function addLabel(parent: Mesh, text: string, width: number, depth: number): {
    labelMesh: Mesh;
    labelTexture: DynamicTexture2D;
  } {
    const mounted = requireMounted();
    const texture = createDynamicTexture(mounted.engine, 512, 256, { srgb: true });
    updateDynamicTexture(mounted.engine, texture, makeLabelCanvas(text));
    const labelMaterial = createStandardMaterial();
    labelMaterial.diffuseTexture = texture;
    labelMaterial.emissiveTexture = texture;
    labelMaterial.disableLighting = true;
    const labelMesh = createPlane(mounted.engine, { width: width * 0.78, height: depth * 0.46 });
    labelMesh.name = `${parent.name}-label-plane`;
    labelMesh.material = labelMaterial;
    labelMesh.pickable = false;
    setParent(labelMesh, parent);
    labelMesh.position.set(0, 0.052, 0);
    labelMesh.rotation.x = Math.PI / 2;
    addToScene(mounted.scene, labelMesh);
    return { labelMesh, labelTexture: texture };
  }

  function makePiece(entity: EntityRecord): PieceGraph | null {
    const mounted = requireMounted();
    const { components } = entity;
    let label = "";
    let color = "#d7b26d";
    let width = 0.9;
    let depth = 0.9;
    let height = 0.18;
    if (components.card !== undefined) {
      width = 0.86;
      depth = 1.22;
      height = 0.09;
      const definition = currentView?.definitions[components.card.definitionId];
      const faceUp = cardFaceUp(entity);
      label = faceUp ? definition?.label ?? components.card.definitionId : "DIGIPOLOGY";
      color = faceUp ? definition?.color ?? "#e7dfc8" : "#9e402d";
    } else if (components.die !== undefined) {
      width = depth = height = 0.72;
      label = String(components.die.value);
      color = "#e8dfc9";
    } else if (components.counter !== undefined) {
      width = depth = 0.72;
      height = 0.2;
      label = String(components.counter.value);
      color = "#d5ff76";
    } else {
      return null;
    }
    const restingY = TABLE_SURFACE_Y + height / 2;
    const mesh = createBox(mounted.engine, { width, depth, height });
    mesh.name = `entity-${entity.id}`;
    mesh.metadata = { entityId: entity.id };
    mesh.pickable = true;
    const pieceMaterial = makeMaterial(color);
    mesh.material = pieceMaterial;
    applyTransform(mesh, components.transform, restingY);
    addToScene(mounted.scene, mesh);
    const graph: PieceGraph = {
      mesh,
      material: pieceMaterial,
      signature: displaySignature(entity),
      transformSignature: transformSignature(components.transform, restingY),
      restingY,
      grabbable: dependencies.sendAction !== undefined && components.grabbable?.enabled === true,
    };
    if (graph.grabbable) {
      graph.bounds = {
        minX: -TABLE_WIDTH / 2 + width / 2,
        maxX: TABLE_WIDTH / 2 - width / 2,
        minZ: -TABLE_DEPTH / 2 + depth / 2,
        maxZ: TABLE_DEPTH / 2 - depth / 2,
        restingY,
      };
    }
    if (label !== "") Object.assign(graph, addLabel(mesh, label, width, depth));
    applyPieceHighlight(graph);
    return graph;
  }

  function attachCamera(): void {
    if (detachCameraControl !== null || canvas === null || scene === null || cameraGraph === null) return;
    detachCameraControl = attachControl(cameraGraph, canvas, scene, {
      shouldHandlePointerDown: (event) => event.pointerType !== "touch",
      isExternalDragActive: () => activeDrag !== null,
      isExternalPickPending: () => pickPending,
    });
  }

  function detachCamera(): void {
    detachCameraControl?.();
    detachCameraControl = null;
  }

  function finishDrag(pointerId: number): void {
    if (activeDrag?.pointerId !== pointerId) return;
    const piece = pieces.get(activeDrag.entityId);
    if (piece !== undefined && piece.bounds !== undefined) {
      piece.mesh.position.x = clamp(piece.mesh.position.x, piece.bounds.minX, piece.bounds.maxX);
      piece.mesh.position.z = clamp(piece.mesh.position.z, piece.bounds.minZ, piece.bounds.maxZ);
      piece.mesh.position.y = piece.bounds.restingY;
      activeDrag.callbacks.onDrop({
        x: piece.mesh.position.x,
        y: piece.mesh.position.y,
        z: piece.mesh.position.z,
      });
    }
    activeDrag = null;
    highlights.held = null;
    if (piece !== undefined) applyPieceHighlight(piece);
    attachCamera();
    if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  const adapter: SceneAdapter = {
    handlesDesktopDrag: false,
    async mount(nextCanvas: HTMLCanvasElement, options: SceneAdapterMountOptions): Promise<void> {
      canvas = nextCanvas;
      engine = await createEngine(canvas, {
        maxDevicePixelRatio: 2,
        msaaSamples: options.tier === "default" ? 4 : 1,
        srgb: true,
      });
      scene = createSceneContext(engine);
      scene.clearColor = { r: 0.031, g: 0.067, b: 0.055, a: 1 };
      cameraGraph = createArcRotateCamera(-Math.PI / 2, 0.92, 11.8, { x: 0, y: 0, z: 0 });
      cameraGraph.panningSensibility = 175;
      cameraGraph.wheelPrecision = 42;
      cameraGraph.inertia = 0.72;
      cameraGraph.angularSensibility = 1_000;
      scene.camera = cameraGraph;
      addToScene(scene, cameraGraph);
      detachCameraLimits = setCameraLimits(cameraGraph, {
        lowerBetaLimit: 0.38,
        upperBetaLimit: 1.32,
        lowerRadiusLimit: 7.3,
        upperRadiusLimit: 16,
      }, scene);
      attachCamera();

      const felt = createStandardMaterial();
      felt.diffuseColor = hexColor("#173f32", "#173f32");
      felt.specularColor = hexColor("#07130f", "#07130f");
      felt.specularPower = 8;
      const table = createBox(engine, { width: TABLE_WIDTH, depth: TABLE_DEPTH, height: 0.42 });
      table.name = "table-surface";
      table.position.y = TABLE_SURFACE_Y - 0.21;
      table.material = felt;
      table.pickable = false;
      addToScene(scene, table);

      const ambient = createHemisphericLight([0, 1, 0], 0.78);
      ambient.diffuseColor = hexColor("#d7eadf", "#d7eadf");
      ambient.groundColor = hexColor("#101913", "#101913");
      addToScene(scene, ambient);
      const key = createDirectionalLight([-0.55, -1, 0.4], 1.5);
      key.position.set(5, 9, -5);
      key.diffuse = hexColor("#fff1d7", "#fff1d7");
      addToScene(scene, key);

      picker = createGpuPicker(scene);
      onBeforeRender(scene, (deltaMs) => {
        for (const piece of pieces.values()) updateCorrection(piece, deltaMs);
      });
      await registerScene(scene);
      await startEngine(engine);
      rendering = true;
    },
    dispose(): void {
      detachCamera();
      detachCameraLimits?.();
      detachCameraLimits = null;
      if (picker !== null) disposePicker(picker);
      picker = null;
      if (engine !== null) stopEngine(engine);
      rendering = false;
      if (scene !== null) disposeScene(scene);
      if (engine !== null) disposeEngine(engine);
      pieces.clear();
      activeDrag = null;
      cameraGraph = null;
      scene = null;
      engine = null;
      canvas = null;
    },
    syncEntities(view: KernelStoreSnapshot): void {
      currentView = view;
      const state = view.displayedState;
      const correctionId = view.correction?.id ?? null;
      if (state === null) return;
      if (state === lastDisplayedState && view.definitions === lastDefinitions && correctionId === lastCorrectionId) return;
      lastDisplayedState = state;
      lastDefinitions = view.definitions;
      lastCorrectionId = correctionId;
      const ids = Object.keys(state.entities).sort();
      for (const [id, piece] of pieces) {
        if (!(id in state.entities)) {
          destroyPiece(piece);
          pieces.delete(id);
        }
      }
      for (const id of ids) {
        const entity = state.entities[id];
        if (entity === undefined) continue;
        const existing = pieces.get(id);
        if (existing === undefined) {
          const created = makePiece(entity);
          if (created !== null) pieces.set(id, created);
        } else if (existing.signature !== displaySignature(entity)) {
          destroyPiece(existing);
          const created = makePiece(entity);
          if (created === null) pieces.delete(id);
          else pieces.set(id, created);
        } else {
          const nextTransformSignature = transformSignature(entity.components.transform, existing.restingY);
          const correction = view.correction?.entityId === id && existing.lastCorrectionId !== view.correction.id
            ? view.correction
            : null;
          if (correction !== null) {
            existing.lastCorrectionId = correction.id;
            startCorrection(existing, entity.components.transform);
          } else if (existing.transformSignature !== nextTransformSignature) {
            delete existing.correction;
            applyTransform(existing.mesh, entity.components.transform, existing.restingY);
          }
          existing.transformSignature = nextTransformSignature;
          existing.grabbable = dependencies.sendAction !== undefined && entity.components.grabbable?.enabled === true;
        }
      }
    },
    async pick(x: number, y: number): Promise<string | null> {
      if (picker === null) return null;
      pickPending = true;
      try {
        const result = await pickAsync(picker, x, y, {
          filter: (mesh) => {
            const entityId = (mesh.metadata as { entityId?: unknown } | undefined)?.entityId;
            return typeof entityId === "string" && pieces.has(entityId);
          },
        });
        const entityId = (result.pickedMesh?.metadata as { entityId?: unknown } | undefined)?.entityId;
        return result.hit && typeof entityId === "string" ? entityId : null;
      } finally {
        pickPending = false;
      }
    },
    isGrabbable(entityId: string): boolean {
      return pieces.get(entityId)?.grabbable === true;
    },
    beginDrag(entityId: string, pointerId: number, x: number, y: number): void {
      if (paused || activeDrag !== null || dependencies.sendAction === undefined) return;
      const piece = pieces.get(entityId);
      if (piece?.grabbable !== true || piece.bounds === undefined) return;
      const callbacks = createDragActionCallbacks(
        entityId,
        dependencies.sendAction,
        () => currentView?.displayedState?.entities[entityId]?.components.transform,
        () => !paused,
      );
      activeDrag = { entityId, pointerId, callbacks };
      piece.mesh.position.y = piece.bounds.restingY + LIFT_HEIGHT;
      highlights.held = entityId;
      applyPieceHighlight(piece);
      detachCamera();
      canvas?.setPointerCapture(pointerId);
      callbacks.onGrab();
      adapter.updateDrag(pointerId, x, y);
    },
    updateDrag(pointerId: number, x: number, y: number): void {
      if (activeDrag?.pointerId !== pointerId || canvas === null || cameraGraph === null) return;
      const piece = pieces.get(activeDrag.entityId);
      if (piece?.bounds === undefined) return;
      const ray = createScreenRay(cameraGraph, canvas, x, y);
      if (ray === null) return;
      const point = { x: 0, y: 0, z: 0 };
      if (intersectRayWithHorizontalPlaneToRef(ray, piece.bounds.restingY + LIFT_HEIGHT, point)) {
        piece.mesh.position.x = clamp(point.x, piece.bounds.minX, piece.bounds.maxX);
        piece.mesh.position.z = clamp(point.z, piece.bounds.minZ, piece.bounds.maxZ);
      }
    },
    endDrag(pointerId: number): void {
      finishDrag(pointerId);
    },
    cancelDrag(pointerId: number): void {
      finishDrag(pointerId);
    },
    setHighlight(entityId: string | null, kind: HighlightKind): void {
      const previous = highlights[kind];
      highlights[kind] = entityId;
      if (previous !== null) {
        const piece = pieces.get(previous);
        if (piece !== undefined) applyPieceHighlight(piece);
      }
      if (entityId !== null) {
        const piece = pieces.get(entityId);
        if (piece !== undefined) applyPieceHighlight(piece);
      }
    },
    camera: {
      attach: attachCamera,
      detach: detachCamera,
      pan(dx: number, dy: number): void {
        if (cameraGraph === null) return;
        cameraGraph.inertialAlphaOffset -= dx / 1_000;
        cameraGraph.inertialBetaOffset -= dy / 1_000;
      },
      pinch(previousDistance: number, distance: number): void {
        if (cameraGraph !== null) cameraGraph.inertialRadiusOffset += (distance - previousDistance) / 60;
      },
    },
    setPaused(nextPaused: boolean): void {
      paused = nextPaused;
      if (paused && activeDrag !== null) adapter.cancelDrag(activeDrag.pointerId);
    },
    resize(): void {
      if (engine !== null) resizeEngine(engine);
    },
    setRenderLoop(running: boolean): void {
      if (engine === null || rendering === running) return;
      if (running) void startEngine(engine);
      else stopEngine(engine);
      rendering = running;
    },
  };

  return adapter;
}
