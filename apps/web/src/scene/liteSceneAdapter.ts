import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createCylinder,
  createDirectionalLight,
  createDynamicTexture,
  createEngine,
  createGpuPicker,
  createHemisphericLight,
  createPlane,
  createSceneContext,
  createStandardMaterial,
  createTorus,
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
import { piecePresentation, piecePresentationSignature } from "./piecePresentation";

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
  labelBillboard?: boolean;
  lastCorrectionId?: number;
  correction?: CorrectionAnimation;
  spawn?: {
    elapsed: number;
    fromY: number;
    toY: number;
    toScaling: [number, number, number];
  };
  landing?: {
    elapsed: number;
    scaling: [number, number, number];
  };
}

const LIFT_HEIGHT = 0.22;
const HIGHLIGHT_COLORS: Record<HighlightKind, [number, number, number]> = {
  hover: [0.18, 0.12, 0.04],
  selected: [0.23, 0.16, 0.05],
  held: [0.42, 0.34, 0.13],
  locked: [0.42, 0.12, 0.06],
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

function updateSpawnAndLanding(piece: PieceGraph, deltaMs: number): void {
  const spawn = piece.spawn;
  if (spawn !== undefined) {
    spawn.elapsed += deltaMs;
    const linear = Math.min(spawn.elapsed / 420, 1);
    const offset = linear - 1;
    const eased = 1 + 2.70158 * offset ** 3 + 1.70158 * offset ** 2;
    piece.mesh.position.y = mix(spawn.fromY, spawn.toY, eased);
    piece.mesh.scaling.set(
      spawn.toScaling[0] * mix(0.72, 1, eased),
      spawn.toScaling[1] * mix(0.72, 1, eased),
      spawn.toScaling[2] * mix(0.72, 1, eased),
    );
    if (linear === 1) delete piece.spawn;
    return;
  }
  const landing = piece.landing;
  if (landing === undefined) return;
  landing.elapsed += deltaMs;
  const linear = Math.min(landing.elapsed / 260, 1);
  const pulse = Math.sin(linear * Math.PI) * (1 - linear);
  piece.mesh.scaling.set(
    landing.scaling[0] * (1 + pulse * 0.08),
    landing.scaling[1] * (1 - pulse * 0.12),
    landing.scaling[2] * (1 + pulse * 0.08),
  );
  if (linear === 1) delete piece.landing;
}

/**
 * Camera-facing orientation for counter labels (Lite has no `billboardMode`).
 *
 * The plane's front normal is local -Z. Pitch it about local X by (PI/2 - beta)
 * and then yaw about world Y by (-alpha - PI/2) so the normal equals the
 * camera's direction from its target while local +X stays horizontal (text
 * upright, no roll). Lite's Euler proxy composes X-then-Y, which is the wrong
 * order for a billboard, so the quaternion is built directly (qYaw ⊗ qPitch).
 * The label is a child of the piece, so the piece's rotation is removed
 * (conj(parent) ⊗ world) to keep the world-space orientation camera-facing.
 */
function orientBillboardLabel(piece: PieceGraph, camera: ArcRotateCamera | null): void {
  if (piece.labelBillboard !== true || piece.labelMesh === undefined || camera === null) return;
  const halfPitch = (Math.PI / 2 - camera.beta) / 2;
  const halfYaw = (-camera.alpha - Math.PI / 2) / 2;
  const sinPitch = Math.sin(halfPitch);
  const cosPitch = Math.cos(halfPitch);
  const sinYaw = Math.sin(halfYaw);
  const cosYaw = Math.cos(halfYaw);
  const wx = cosYaw * sinPitch;
  const wy = cosPitch * sinYaw;
  const wz = -sinYaw * sinPitch;
  const ww = cosYaw * cosPitch;
  const parent = piece.mesh.rotationQuaternion;
  const px = -parent.x;
  const py = -parent.y;
  const pz = -parent.z;
  const pw = parent.w;
  piece.labelMesh.rotationQuaternion.set(
    pw * wx + px * ww + py * wz - pz * wy,
    pw * wy - px * wz + py * ww + pz * wx,
    pw * wz + px * wy - py * wx + pz * ww,
    pw * ww - px * wx - py * wy - pz * wz,
  );
}

function makeLabelCanvas(text: string, color: string, background: string, compact: boolean): HTMLCanvasElement {
  const label = document.createElement("canvas");
  label.width = 512;
  label.height = 256;
  const context = label.getContext("2d");
  if (context !== null) {
    context.clearRect(0, 0, label.width, label.height);
    context.beginPath();
    context.roundRect(compact ? 112 : 12, 12, compact ? 288 : 488, 232, compact ? 116 : 28);
    context.fillStyle = background;
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.22)";
    context.lineWidth = 8;
    context.stroke();
    context.fillStyle = color;
    context.font = `bold ${compact ? 108 : 54}px Manrope, sans-serif`;
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
  const highlights = {
    hover: null as string | null,
    selected: null as string | null,
    held: new Set<string>(),
    locked: new Set<string>(),
  };
  let localHeld: string | null = null;
  const pieces = new Map<string, PieceGraph>();

  function blockLiteTouchGesture(event: TouchEvent): void {
    // Lite attachControl has no touch opt-out, so the shared gesture machine owns touch input.
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  }

  function requireMounted() {
    if (canvas === null || engine === null || scene === null || cameraGraph === null) {
      throw new Error("Babylon-Lite scene adapter is not mounted");
    }
    return { canvas, engine, scene, camera: cameraGraph };
  }

  function applyPieceHighlight(piece: PieceGraph): void {
    let color: [number, number, number] = [0, 0, 0];
    const entityId = (piece.mesh.metadata as { entityId?: unknown } | undefined)?.entityId;
    if (typeof entityId === "string") {
      if (highlights.hover === entityId) color = HIGHLIGHT_COLORS.hover;
      if (highlights.selected === entityId) color = HIGHLIGHT_COLORS.selected;
      if (highlights.locked.has(entityId)) color = HIGHLIGHT_COLORS.locked;
      if (highlights.held.has(entityId)) color = HIGHLIGHT_COLORS.held;
      if (localHeld === entityId) color = HIGHLIGHT_COLORS.held;
    }
    piece.material.emissiveColor = color;
    markMaterialUboDirty(piece.material);
  }

  function destroyPiece(piece: PieceGraph): void {
    if (scene === null) return;
    if (piece.labelMesh !== undefined) removeFromScene(scene, piece.labelMesh);
    removeFromScene(scene, piece.mesh);
  }

  function makeMaterial(appearance: ReturnType<typeof piecePresentation>): StandardMaterialProps {
    const result = createStandardMaterial();
    result.diffuseColor = hexColor(appearance.color, "#d7b26d");
    result.specularColor = hexColor(appearance.specular, "#271d10");
    result.emissiveColor = hexColor(appearance.emissive, "#000000");
    result.alpha = appearance.alpha;
    result.specularPower = 28;
    return result;
  }

  function addLabel(parent: Mesh, appearance: ReturnType<typeof piecePresentation>): {
    labelMesh: Mesh;
    labelTexture: DynamicTexture2D;
  } {
    const mounted = requireMounted();
    const texture = createDynamicTexture(mounted.engine, 512, 256, { srgb: true });
    updateDynamicTexture(mounted.engine, texture, makeLabelCanvas(
      appearance.label,
      appearance.labelColor,
      appearance.labelBackground,
      appearance.billboardLabel,
    ));
    const labelMaterial = createStandardMaterial();
    labelMaterial.diffuseTexture = texture;
    labelMaterial.diffuseColor = [1, 1, 1];
    labelMaterial.ambientColor = [0.38, 0.38, 0.38];
    labelMaterial.specularColor = [0.05, 0.05, 0.05];
    labelMaterial.alphaCutOff = 0.04;
    labelMaterial.backFaceCulling = false;
    const labelMesh = createPlane(mounted.engine, { width: appearance.width * 0.78, height: appearance.depth * 0.46 });
    labelMesh.name = `${parent.name}-label-plane`;
    labelMesh.material = labelMaterial;
    labelMesh.pickable = false;
    setParent(labelMesh, parent);
    labelMesh.position.set(0, appearance.billboardLabel ? 0.48 : appearance.height / 2 + 0.006, 0);
    labelMesh.rotation.x = appearance.billboardLabel ? 0 : Math.PI / 2;
    addToScene(mounted.scene, labelMesh);
    return { labelMesh, labelTexture: texture };
  }

  function makePiece(entity: EntityRecord): PieceGraph | null {
    const mounted = requireMounted();
    const { components } = entity;
    if (components.hand !== undefined) {
      return null;
    } else if (components.transform === undefined && components.counter === undefined &&
      components.deck === undefined && components.card === undefined && components.die === undefined) {
      return null;
    }
    const definitionId = components.card?.definitionId ?? components.die?.definitionId;
    const appearance = piecePresentation(
      entity,
      definitionId === undefined ? undefined : currentView?.definitions[definitionId],
    );
    const restingY = TABLE_SURFACE_Y + appearance.height / 2;
    const mesh = appearance.shape === "ring"
      ? createTorus(mounted.engine, {
          diameter: appearance.width,
          thickness: appearance.height,
          tessellation: 48,
        })
      : appearance.shape === "cylinder"
      ? createCylinder(mounted.engine, {
          height: appearance.height,
          diameter: appearance.width,
          tessellation: 48,
        })
      : createBox(mounted.engine, {
          width: appearance.width,
          depth: appearance.depth,
          height: appearance.height,
        });
    mesh.name = `entity-${entity.id}`;
    mesh.metadata = { entityId: entity.id, displayLabel: appearance.label };
    mesh.pickable = true;
    const pieceMaterial = makeMaterial(appearance);
    mesh.material = pieceMaterial;
    applyTransform(mesh, components.transform, restingY);
    addToScene(mounted.scene, mesh);
    const graph: PieceGraph = {
      mesh,
      material: pieceMaterial,
      signature: piecePresentationSignature(entity),
      transformSignature: transformSignature(components.transform, restingY),
      restingY,
      grabbable: dependencies.sendAction !== undefined
        && components.grabbable?.enabled === true
        && components.grabbable.heldBy === null
        && components.lockable?.locked !== true,
    };
    const targetScaling: [number, number, number] = [mesh.scaling.x, mesh.scaling.y, mesh.scaling.z];
    const targetY = mesh.position.y;
    graph.spawn = { elapsed: 0, fromY: targetY - 0.08, toY: targetY, toScaling: targetScaling };
    mesh.position.y = targetY - 0.08;
    mesh.scaling.set(targetScaling[0] * 0.72, targetScaling[1] * 0.72, targetScaling[2] * 0.72);
    if (graph.grabbable) {
      graph.bounds = {
        minX: -TABLE_WIDTH / 2 + appearance.width / 2,
        maxX: TABLE_WIDTH / 2 - appearance.width / 2,
        minZ: -TABLE_DEPTH / 2 + appearance.depth / 2,
        maxZ: TABLE_DEPTH / 2 - appearance.depth / 2,
        restingY,
      };
    }
    if (appearance.label !== "") {
      Object.assign(graph, addLabel(mesh, appearance));
      graph.labelBillboard = appearance.billboardLabel;
      orientBillboardLabel(graph, cameraGraph);
    }
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
      piece.landing = {
        elapsed: 0,
        scaling: [piece.mesh.scaling.x, piece.mesh.scaling.y, piece.mesh.scaling.z],
      };
    }
    activeDrag = null;
    localHeld = null;
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
      scene.clearColor = { r: 0.018, g: 0.027, b: 0.024, a: 1 };
      cameraGraph = createArcRotateCamera(-1.46, 0.82, 13.2, { x: 0, y: 0, z: 0 });
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
      canvas.addEventListener("touchstart", blockLiteTouchGesture, { passive: false });
      canvas.addEventListener("touchmove", blockLiteTouchGesture, { passive: false });
      canvas.addEventListener("touchend", blockLiteTouchGesture, { passive: false });
      canvas.addEventListener("touchcancel", blockLiteTouchGesture, { passive: false });
      attachCamera();

      const mountedEngine = engine;
      const mountedScene = scene;
      const addStaticBox = (name: string, width: number, depth: number, height: number, y: number, color: string) => {
        const staticMaterial = createStandardMaterial();
        staticMaterial.diffuseColor = hexColor(color, color);
        staticMaterial.specularColor = hexColor("#120d0a", "#120d0a");
        staticMaterial.specularPower = 20;
        const mesh = createBox(mountedEngine, { width, depth, height });
        mesh.name = name;
        mesh.position.y = y;
        mesh.material = staticMaterial;
        mesh.pickable = false;
        addToScene(mountedScene, mesh);
        return mesh;
      };
      addStaticBox("floor", 40, 40, 0.08, -0.82, "#090d0c");
      addStaticBox("table-base", TABLE_WIDTH + 0.62, TABLE_DEPTH + 0.62, 0.34, TABLE_SURFACE_Y - 0.29, "#17110f");
      addStaticBox("table-surface", TABLE_WIDTH, TABLE_DEPTH, 0.12, TABLE_SURFACE_Y - 0.06, "#123529");
      const railNorth = addStaticBox("table-rail-north", TABLE_WIDTH + 0.7, 0.3, 0.28, TABLE_SURFACE_Y + 0.02, "#33231b");
      const railSouth = addStaticBox("table-rail-south", TABLE_WIDTH + 0.7, 0.3, 0.28, TABLE_SURFACE_Y + 0.02, "#33231b");
      const railWest = addStaticBox("table-rail-west", 0.3, TABLE_DEPTH + 0.1, 0.28, TABLE_SURFACE_Y + 0.02, "#2b1d17");
      const railEast = addStaticBox("table-rail-east", 0.3, TABLE_DEPTH + 0.1, 0.28, TABLE_SURFACE_Y + 0.02, "#2b1d17");
      railNorth.position.z = -TABLE_DEPTH / 2 - 0.14;
      railSouth.position.z = TABLE_DEPTH / 2 + 0.14;
      railWest.position.x = -TABLE_WIDTH / 2 - 0.14;
      railEast.position.x = TABLE_WIDTH / 2 + 0.14;

      const ambient = createHemisphericLight([0, 1, 0], 0.44);
      ambient.diffuseColor = hexColor("#c7ddd1", "#c7ddd1");
      ambient.groundColor = hexColor("#090d0b", "#090d0b");
      addToScene(scene, ambient);
      const key = createDirectionalLight([-0.55, -1, 0.4], 0.95);
      key.position.set(5, 9, -5);
      key.diffuse = hexColor("#fff1d7", "#fff1d7");
      addToScene(scene, key);

      picker = createGpuPicker(scene);
      let cameraIntroMs = 0;
      onBeforeRender(scene, (deltaMs) => {
        if (cameraGraph !== null && cameraIntroMs < 900) {
          cameraIntroMs += deltaMs;
          const linear = Math.min(cameraIntroMs / 900, 1);
          const eased = 1 - (1 - linear) ** 3;
          cameraGraph.alpha = mix(-1.46, -Math.PI / 2, eased);
          cameraGraph.beta = mix(0.82, 0.92, eased);
          cameraGraph.radius = mix(13.2, 11.8, eased);
        }
        for (const piece of pieces.values()) {
          updateSpawnAndLanding(piece, deltaMs);
          updateCorrection(piece, deltaMs);
          orientBillboardLabel(piece, cameraGraph);
        }
      });
      await registerScene(scene);
      await startEngine(engine);
      rendering = true;
    },
    dispose(): void {
      detachCamera();
      canvas?.removeEventListener("touchstart", blockLiteTouchGesture);
      canvas?.removeEventListener("touchmove", blockLiteTouchGesture);
      canvas?.removeEventListener("touchend", blockLiteTouchGesture);
      canvas?.removeEventListener("touchcancel", blockLiteTouchGesture);
      detachCameraLimits?.();
      detachCameraLimits = null;
      if (picker !== null) disposePicker(picker);
      picker = null;
      if (engine !== null) stopEngine(engine);
      rendering = false;
      for (const piece of pieces.values()) destroyPiece(piece);
      pieces.clear();
      if (scene !== null) disposeScene(scene);
      if (engine !== null) disposeEngine(engine);
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
      const contained = new Set<string>();
      for (const entity of Object.values(state.entities)) {
        for (const item of entity.components.container?.items ?? []) contained.add(item);
      }
      const ids = Object.keys(state.entities).sort().filter((id) => !contained.has(id) && state.entities[id]?.components.hand === undefined);
      const visible = new Set(ids);
      for (const [id, piece] of pieces) {
        if (!visible.has(id)) {
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
        } else if (existing.signature !== piecePresentationSignature(entity)) {
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
          existing.grabbable = dependencies.sendAction !== undefined
            && entity.components.grabbable?.enabled === true
            && entity.components.grabbable.heldBy === null
            && entity.components.lockable?.locked !== true;
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
    projectToTable(x: number, y: number) {
      if (canvas === null || cameraGraph === null || x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight) return null;
      const ray = createScreenRay(cameraGraph, canvas, x, y);
      if (ray === null) return null;
      const point = { x: 0, y: 0, z: 0 };
      return intersectRayWithHorizontalPlaneToRef(ray, TABLE_SURFACE_Y, point) ? point : null;
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
      localHeld = entityId;
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
      if (kind === "held" || kind === "locked") {
        const targets = highlights[kind];
        if (entityId === null) {
          const previous = [...targets];
          targets.clear();
          for (const id of previous) {
            const piece = pieces.get(id);
            if (piece !== undefined) applyPieceHighlight(piece);
          }
        } else {
          targets.add(entityId);
          const piece = pieces.get(entityId);
          if (piece !== undefined) applyPieceHighlight(piece);
        }
        return;
      }
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
