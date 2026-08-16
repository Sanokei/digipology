import { Engine } from "@babylonjs/core/Engines/engine";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { EntityRecord, TransformComponent } from "digipology-kernel";

import type { KernelStoreSnapshot } from "../state/kernelStore";
import { attachDragBehavior, type AttachedDragBehavior } from "./dragBehavior";
import { createDragActionCallbacks } from "./dragActions";
import { hardwareScalingLevel } from "./rendererPolicy";
import type {
  HighlightKind,
  SceneAdapter,
  SceneAdapterDependencies,
  SceneAdapterMountOptions,
} from "./sceneAdapter";
import {
  TABLE_DEPTH,
  TABLE_SURFACE_Y,
  TABLE_WIDTH,
  buildCamera,
  buildLighting,
  buildTableSurface,
} from "./table";

type PieceDragBounds = Parameters<typeof attachDragBehavior>[0]["bounds"];

interface PieceGraph {
  mesh: Mesh;
  signature: string;
  transformSignature: string;
  restingY: number;
  dragBounds?: PieceDragBounds;
  drag?: AttachedDragBehavior;
  cancelCorrection?: () => void;
  lastCorrectionId?: number;
  label?: DynamicTexture;
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

function material(scene: Scene, name: string, color: string): StandardMaterial {
  const result = new StandardMaterial(`${name}-material`, scene);
  try {
    result.diffuseColor = Color3.FromHexString(color);
  } catch {
    result.diffuseColor = Color3.FromHexString("#d7b26d");
  }
  result.specularColor = Color3.FromHexString("#271d10");
  result.roughness = 0.72;
  return result;
}

function labelPlane(
  scene: Scene,
  parent: Mesh,
  text: string,
  width: number,
  height: number,
  billboard = false,
): DynamicTexture {
  const texture = new DynamicTexture(`${parent.name}-label`, { width: 512, height: 256 }, scene, false);
  texture.hasAlpha = true;
  texture.drawText(text.slice(0, 28), null, 150, "bold 54px Manrope", "#102018", "transparent", true, true);
  const mat = new StandardMaterial(`${parent.name}-label-material`, scene);
  mat.diffuseTexture = texture;
  mat.opacityTexture = texture;
  mat.emissiveColor = Color3.FromHexString("#dce8d8");
  const plane = CreatePlane(`${parent.name}-label-plane`, { width, height }, scene);
  plane.parent = parent;
  plane.position.y = billboard ? 0.68 : 0.052;
  plane.rotation.x = billboard ? 0 : Math.PI / 2;
  plane.billboardMode = billboard ? Mesh.BILLBOARDMODE_ALL : Mesh.BILLBOARDMODE_NONE;
  plane.material = mat;
  plane.isPickable = false;
  return texture;
}

function transformSignature(transform: TransformComponent | undefined, restingY: number): string {
  if (transform === undefined) return `default:0:${restingY}:0:0:0:0:1:1:1:1`;
  const { position, rotation, scale } = transform;
  return `${position.x}:${position.y}:${position.z}:${rotation.x}:${rotation.y}:${rotation.z}:${rotation.w}:${scale.x}:${scale.y}:${scale.z}`;
}

function transformTarget(transform: TransformComponent | undefined, restingY: number) {
  return transform === undefined
    ? { position: new Vector3(0, restingY, 0), scaling: Vector3.One(), rotation: Quaternion.Identity() }
    : {
        position: new Vector3(transform.position.x, transform.position.y, transform.position.z),
        scaling: new Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
        rotation: new Quaternion(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w),
      };
}

function applyTransform(mesh: Mesh, transform: TransformComponent | undefined, restingY: number): void {
  const target = transformTarget(transform, restingY);
  mesh.position.copyFrom(target.position);
  mesh.scaling.copyFrom(target.scaling);
  mesh.rotationQuaternion ??= Quaternion.Identity();
  mesh.rotationQuaternion.copyFrom(target.rotation);
}

function animateTransform(
  scene: Scene,
  mesh: Mesh,
  transform: TransformComponent | undefined,
  restingY: number,
): () => void {
  const fromPosition = mesh.position.clone();
  const fromScaling = mesh.scaling.clone();
  const fromRotation = mesh.rotationQuaternion?.clone() ?? Quaternion.Identity();
  const target = transformTarget(transform, restingY);
  mesh.rotationQuaternion ??= Quaternion.Identity();
  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime();
    const linear = Math.min(elapsed / 180, 1);
    const eased = 1 - (1 - linear) ** 3;
    Vector3.LerpToRef(fromPosition, target.position, eased, mesh.position);
    Vector3.LerpToRef(fromScaling, target.scaling, eased, mesh.scaling);
    Quaternion.SlerpToRef(fromRotation, target.rotation, eased, mesh.rotationQuaternion!);
    if (linear === 1) scene.onBeforeRenderObservable.remove(observer);
  });
  return () => scene.onBeforeRenderObservable.remove(observer);
}

export function createWebglSceneAdapter(dependencies: SceneAdapterDependencies): SceneAdapter {
  let canvas: HTMLCanvasElement | null = null;
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let cameraGraph: ReturnType<typeof buildCamera> | null = null;
  let shadows: ReturnType<typeof buildLighting>["shadows"] = null;
  let paused = false;
  let rendering = false;
  let selectedEntityId: string | null = null;
  let activeDrag: { entityId: string; pointerId: number } | null = null;
  let currentView: KernelStoreSnapshot | null = null;
  let lastDisplayedState: KernelStoreSnapshot["displayedState"] = null;
  let lastDefinitions: KernelStoreSnapshot["definitions"] | null = null;
  let lastCorrectionId: number | null = null;
  let dprQuery: MediaQueryList | null = null;
  const pieces = new Map<string, PieceGraph>();

  const render = () => scene?.render();

  function requireMounted() {
    if (canvas === null || engine === null || scene === null || cameraGraph === null) {
      throw new Error("WebGL scene adapter is not mounted");
    }
    return { canvas, engine, scene, camera: cameraGraph };
  }

  function destroyPiece(piece: PieceGraph): void {
    piece.drag?.dispose();
    piece.cancelCorrection?.();
    piece.label?.dispose();
    piece.mesh.dispose(false, true);
  }

  function attachPieceDrag(piece: PieceGraph, entityId: string, bounds: PieceDragBounds): void {
    if (dependencies.sendAction === undefined) return;
    const mounted = requireMounted();
    piece.dragBounds = bounds;
    const actionCallbacks = createDragActionCallbacks(
      entityId,
      dependencies.sendAction,
      () => currentView?.displayedState?.entities[entityId]?.components.transform,
      () => !paused,
    );
    piece.drag = attachDragBehavior({
      scene: mounted.scene,
      camera: mounted.camera,
      canvas: mounted.canvas,
      mesh: piece.mesh,
      bounds,
      canInteract: () => !paused,
      ...actionCallbacks,
    });
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
    const mesh = CreateBox(`entity-${entity.id}`, { width, depth, height }, mounted.scene);
    mesh.metadata = { entityId: entity.id };
    mesh.isPickable = true;
    mesh.material = material(mounted.scene, entity.id, color);
    applyTransform(mesh, components.transform, restingY);
    shadows?.addShadowCaster(mesh);
    const graph: PieceGraph = {
      mesh,
      signature: displaySignature(entity),
      transformSignature: transformSignature(components.transform, restingY),
      restingY,
      ...(label
        ? { label: labelPlane(mounted.scene, mesh, label, width * 0.78, depth * 0.46, components.counter !== undefined) }
        : {}),
    };
    if (dependencies.sendAction !== undefined && components.grabbable?.enabled === true) {
      attachPieceDrag(graph, entity.id, {
        minX: -TABLE_WIDTH / 2 + width / 2,
        maxX: TABLE_WIDTH / 2 - width / 2,
        minZ: -TABLE_DEPTH / 2 + depth / 2,
        maxZ: TABLE_DEPTH / 2 - depth / 2,
        restingY,
      });
    }
    graph.drag?.setTouchSelected(entity.id === selectedEntityId);
    return graph;
  }

  function handleDprChange(): void {
    if (engine === null) return;
    dprQuery?.removeEventListener("change", handleDprChange);
    engine.setHardwareScalingLevel(hardwareScalingLevel(window.devicePixelRatio));
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", handleDprChange);
    engine.resize();
  }

  const adapter: SceneAdapter = {
    handlesDesktopDrag: true,
    async mount(nextCanvas: HTMLCanvasElement, options: SceneAdapterMountOptions): Promise<void> {
      canvas = nextCanvas;
      const highQuality = options.tier === "default";
      engine = new Engine(canvas, highQuality, { preserveDrawingBuffer: false, stencil: true });
      handleDprChange();
      scene = new Scene(engine);
      scene.clearColor = Color4.FromHexString("#08110eff");
      cameraGraph = buildCamera(scene, canvas);
      const table = buildTableSurface(scene);
      shadows = buildLighting(scene, highQuality).shadows;
      table.receiveShadows = shadows !== null;
    },
    dispose(): void {
      adapter.setRenderLoop(false);
      dprQuery?.removeEventListener("change", handleDprChange);
      dprQuery = null;
      for (const piece of pieces.values()) destroyPiece(piece);
      pieces.clear();
      cameraGraph?.detachControl();
      scene?.dispose();
      engine?.dispose();
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
          if (correction !== null && scene !== null) {
            existing.lastCorrectionId = correction.id;
            existing.drag?.dispose();
            delete existing.drag;
            existing.cancelCorrection?.();
            existing.cancelCorrection = animateTransform(scene, existing.mesh, entity.components.transform, existing.restingY);
            if (existing.dragBounds !== undefined && entity.components.grabbable?.enabled === true) {
              attachPieceDrag(existing, entity.id, existing.dragBounds);
            }
          } else if (existing.transformSignature !== nextTransformSignature) {
            existing.cancelCorrection?.();
            delete existing.cancelCorrection;
            applyTransform(existing.mesh, entity.components.transform, existing.restingY);
          }
          existing.transformSignature = nextTransformSignature;
        }
      }
    },
    async pick(x: number, y: number): Promise<string | null> {
      if (scene === null) return null;
      const result = scene.pick(x, y, (mesh) => {
        const entityId = (mesh.metadata as { entityId?: unknown } | null)?.entityId;
        return typeof entityId === "string" && pieces.has(entityId);
      });
      const entityId = (result?.pickedMesh?.metadata as { entityId?: unknown } | null)?.entityId;
      return typeof entityId === "string" ? entityId : null;
    },
    isGrabbable(entityId: string): boolean {
      return pieces.get(entityId)?.drag !== undefined;
    },
    beginDrag(entityId: string, pointerId: number, x: number, y: number): void {
      const drag = pieces.get(entityId)?.drag;
      if (drag === undefined) return;
      activeDrag = { entityId, pointerId };
      drag.beginTouchDrag(pointerId);
      drag.moveTouchDrag(pointerId, x, y);
    },
    updateDrag(pointerId: number, x: number, y: number): void {
      if (activeDrag?.pointerId !== pointerId) return;
      pieces.get(activeDrag.entityId)?.drag?.moveTouchDrag(pointerId, x, y);
    },
    endDrag(pointerId: number): void {
      if (activeDrag?.pointerId !== pointerId) return;
      pieces.get(activeDrag.entityId)?.drag?.finishTouchDrag(pointerId);
      activeDrag = null;
    },
    cancelDrag(pointerId: number): void {
      if (activeDrag?.pointerId !== pointerId) return;
      pieces.get(activeDrag.entityId)?.drag?.cancelTouchDrag(pointerId);
      activeDrag = null;
    },
    setHighlight(entityId: string | null, kind: HighlightKind): void {
      if (kind !== "selected") return;
      selectedEntityId = entityId;
      for (const [id, piece] of pieces) piece.drag?.setTouchSelected(id === entityId);
    },
    camera: {
      attach(): void {
        if (canvas !== null) cameraGraph?.attachControl(canvas, true);
      },
      detach(): void {
        cameraGraph?.detachControl();
      },
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
      engine?.resize();
    },
    setRenderLoop(running: boolean): void {
      if (engine === null || rendering === running) return;
      if (running) engine.runRenderLoop(render);
      else engine.stopRenderLoop(render);
      rendering = running;
    },
  };

  return adapter;
}
