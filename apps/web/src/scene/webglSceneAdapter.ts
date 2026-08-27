import { Engine } from "@babylonjs/core/Engines/engine";
import { Ray } from "@babylonjs/core/Culling/ray.core";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { EntityRecord, TransformComponent } from "digipology-kernel";

import type { KernelStoreSnapshot } from "../state/kernelStore";
import {
  attachDragBehavior,
  type AttachedDragBehavior,
  type HighlightLayerFacade,
  type HighlightLayerFactory,
} from "./dragBehavior";
import { createDragActionCallbacks } from "./dragActions";
import { intersectRayWithHorizontalPlaneToRef } from "./dragPlane";
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
import { piecePresentation, piecePresentationSignature } from "./piecePresentation";

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
  cancelMotion?: () => void;
}

interface WebglSceneAdapterDependencies extends SceneAdapterDependencies {
  createEngine?: (
    canvas: HTMLCanvasElement,
    antialias: boolean,
    options: ConstructorParameters<typeof Engine>[2],
  ) => Engine;
  createLabelTexture?: (name: string, scene: Scene) => DynamicTexture;
  createHighlightLayer?: HighlightLayerFactory;
  matchMedia?: (query: string) => MediaQueryList;
  devicePixelRatio?: () => number;
}

function material(
  scene: Scene,
  name: string,
  appearance: ReturnType<typeof piecePresentation>,
): StandardMaterial {
  const result = new StandardMaterial(`${name}-material`, scene);
  try {
    result.diffuseColor = Color3.FromHexString(appearance.color);
  } catch {
    result.diffuseColor = Color3.FromHexString("#d7b26d");
  }
  result.specularColor = Color3.FromHexString(appearance.specular);
  result.emissiveColor = Color3.FromHexString(appearance.emissive);
  result.alpha = appearance.alpha;
  result.roughness = 0.8;
  return result;
}

function labelPlane(
  scene: Scene,
  parent: Mesh,
  appearance: ReturnType<typeof piecePresentation>,
  createLabelTexture: NonNullable<WebglSceneAdapterDependencies["createLabelTexture"]> = (name, targetScene) => (
    new DynamicTexture(name, { width: 512, height: 256 }, targetScene, false)
  ),
): DynamicTexture {
  const texture = createLabelTexture(`${parent.name}-label`, scene);
  texture.hasAlpha = true;
  texture.drawText(
    appearance.label.slice(0, 28),
    null,
    150,
    "bold 54px Manrope",
    appearance.labelColor,
    appearance.labelBackground,
    true,
    true,
  );
  const mat = new StandardMaterial(`${parent.name}-label-material`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = texture;
  mat.useAlphaFromDiffuseTexture = true;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  const plane = CreatePlane(`${parent.name}-label-plane`, {
    width: appearance.width * 0.78,
    height: appearance.depth * 0.46,
  }, scene);
  plane.parent = parent;
  plane.position.y = appearance.billboardLabel ? 0.68 : appearance.height / 2 + 0.006;
  plane.rotation.x = appearance.billboardLabel ? 0 : Math.PI / 2;
  plane.billboardMode = appearance.billboardLabel ? Mesh.BILLBOARDMODE_ALL : Mesh.BILLBOARDMODE_NONE;
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

function animateSpawn(scene: Scene, mesh: Mesh): () => void {
  const targetScaling = mesh.scaling.clone();
  const targetY = mesh.position.y;
  mesh.scaling.scaleInPlace(0.72);
  mesh.position.y = targetY - 0.08;
  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime();
    const linear = Math.min(elapsed / 420, 1);
    const offset = linear - 1;
    const eased = 1 + 2.70158 * offset ** 3 + 1.70158 * offset ** 2;
    mesh.scaling.copyFrom(targetScaling).scaleInPlace(0.72 + 0.28 * eased);
    mesh.position.y = targetY - 0.08 + 0.08 * eased;
    if (linear === 1) scene.onBeforeRenderObservable.remove(observer);
  });
  return () => scene.onBeforeRenderObservable.remove(observer);
}

function animateLanding(scene: Scene, mesh: Mesh): () => void {
  const targetScaling = mesh.scaling.clone();
  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime();
    const linear = Math.min(elapsed / 260, 1);
    const pulse = Math.sin(linear * Math.PI) * (1 - linear);
    mesh.scaling.set(
      targetScaling.x * (1 + pulse * 0.08),
      targetScaling.y * (1 - pulse * 0.12),
      targetScaling.z * (1 + pulse * 0.08),
    );
    if (linear === 1) scene.onBeforeRenderObservable.remove(observer);
  });
  return () => scene.onBeforeRenderObservable.remove(observer);
}

export function createWebglSceneAdapter(dependencies: WebglSceneAdapterDependencies): SceneAdapter {
  let canvas: HTMLCanvasElement | null = null;
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let cameraGraph: ReturnType<typeof buildCamera> | null = null;
  let shadows: ReturnType<typeof buildLighting>["shadows"] = null;
  let paused = false;
  let rendering = false;
  let presentationHighlight: HighlightLayerFacade | null = null;
  let activeDrag: { entityId: string; pointerId: number } | null = null;
  let currentView: KernelStoreSnapshot | null = null;
  let lastDisplayedState: KernelStoreSnapshot["displayedState"] = null;
  let lastDefinitions: KernelStoreSnapshot["definitions"] | null = null;
  let lastCorrectionId: number | null = null;
  let dprQuery: MediaQueryList | null = null;
  const pieces = new Map<string, PieceGraph>();
  const highlights = {
    hover: null as string | null,
    selected: null as string | null,
    held: new Set<string>(),
    locked: new Set<string>(),
  };

  function refreshHighlight(entityId: string): void {
    const piece = pieces.get(entityId);
    if (piece === undefined || presentationHighlight === null) return;
    presentationHighlight.removeMesh(piece.mesh);
    const kind: HighlightKind | undefined = highlights.held.has(entityId) ? "held"
      : highlights.locked.has(entityId) ? "locked"
        : highlights.selected === entityId ? "selected"
          : highlights.hover === entityId ? "hover" : undefined;
    if (kind === undefined) return;
    const colors: Record<HighlightKind, Color3> = {
      hover: Color3.FromHexString("#f7d89b"), selected: Color3.FromHexString("#f7d89b"),
      held: Color3.FromHexString("#fff2be"), locked: Color3.FromHexString("#ff9f7a"),
    };
    presentationHighlight.addMesh(piece.mesh, colors[kind]);
  }

  function containedIds(view: KernelStoreSnapshot): Set<string> {
    const result = new Set<string>();
    for (const entity of Object.values(view.displayedState?.entities ?? {})) {
      for (const item of entity.components.container?.items ?? []) result.add(item);
    }
    return result;
  }

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
    piece.cancelMotion?.();
    presentationHighlight?.removeMesh(piece.mesh);
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
      canInteract: () => !paused && isEntityGrabbable(entityId),
      ...(dependencies.createHighlightLayer === undefined
        ? {}
        : { createHighlightLayer: dependencies.createHighlightLayer }),
      ...actionCallbacks,
      onDrop(position) {
        piece.cancelMotion?.();
        piece.cancelMotion = animateLanding(mounted.scene, piece.mesh);
        actionCallbacks.onDrop(position);
      },
    });
  }

  function isEntityGrabbable(entityId: string): boolean {
    const entity = currentView?.displayedState?.entities[entityId];
    const grabbable = entity?.components.grabbable;
    return pieces.has(entityId)
      && grabbable?.enabled === true
      && grabbable.heldBy === null
      && entity?.components.lockable?.locked !== true;
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
      ? CreateTorus(`entity-${entity.id}`, {
          diameter: appearance.width,
          thickness: appearance.height,
          tessellation: 48,
        }, mounted.scene)
      : appearance.shape === "cylinder"
      ? CreateCylinder(`entity-${entity.id}`, {
          height: appearance.height,
          diameter: appearance.width,
          tessellation: 48,
        }, mounted.scene)
      : CreateBox(`entity-${entity.id}`, {
          width: appearance.width,
          depth: appearance.depth,
          height: appearance.height,
        }, mounted.scene);
    mesh.metadata = { entityId: entity.id, displayLabel: appearance.label };
    mesh.isPickable = true;
    mesh.material = material(mounted.scene, entity.id, appearance);
    applyTransform(mesh, components.transform, restingY);
    shadows?.addShadowCaster(mesh);
    const graph: PieceGraph = {
      mesh,
      signature: piecePresentationSignature(entity),
      transformSignature: transformSignature(components.transform, restingY),
      restingY,
      ...(appearance.label
        ? {
            label: labelPlane(
              mounted.scene,
              mesh,
              appearance,
              dependencies.createLabelTexture,
            ),
          }
        : {}),
    };
    if (dependencies.sendAction !== undefined && components.grabbable?.enabled === true) {
      attachPieceDrag(graph, entity.id, {
        minX: -TABLE_WIDTH / 2 + appearance.width / 2,
        maxX: TABLE_WIDTH / 2 - appearance.width / 2,
        minZ: -TABLE_DEPTH / 2 + appearance.depth / 2,
        maxZ: TABLE_DEPTH / 2 - appearance.depth / 2,
        restingY,
      });
    }
    graph.cancelMotion = animateSpawn(mounted.scene, mesh);
    return graph;
  }

  function handleDprChange(): void {
    if (engine === null) return;
    dprQuery?.removeEventListener("change", handleDprChange);
    const devicePixelRatio = dependencies.devicePixelRatio?.() ?? window.devicePixelRatio;
    engine.setHardwareScalingLevel(hardwareScalingLevel(devicePixelRatio));
    dprQuery = dependencies.matchMedia?.(`(resolution: ${devicePixelRatio}dppx)`)
      ?? window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", handleDprChange);
    engine.resize();
  }

  const adapter: SceneAdapter = {
    handlesDesktopDrag: true,
    async mount(nextCanvas: HTMLCanvasElement, options: SceneAdapterMountOptions): Promise<void> {
      canvas = nextCanvas;
      const highQuality = options.tier === "default";
      engine = dependencies.createEngine?.(
        canvas,
        highQuality,
        { preserveDrawingBuffer: false, stencil: true },
      ) ?? new Engine(canvas, highQuality, { preserveDrawingBuffer: false, stencil: true });
      handleDprChange();
      scene = new Scene(engine);
      scene.clearColor = Color4.FromHexString("#050806ff");
      cameraGraph = buildCamera(scene, canvas);
      cameraGraph.alpha = -1.46;
      cameraGraph.beta = 0.82;
      cameraGraph.radius = 13.2;
      const table = buildTableSurface(scene);
      shadows = buildLighting(scene, highQuality).shadows;
      table.receiveShadows = shadows !== null;
      presentationHighlight = dependencies.createHighlightLayer?.(scene) ?? new HighlightLayer("presentation-highlight", scene);
      let cameraIntroMs = 0;
      scene.onBeforeRenderObservable.add(() => {
        if (cameraGraph === null || cameraIntroMs >= 900) return;
        cameraIntroMs += scene?.getEngine().getDeltaTime() ?? 0;
        const linear = Math.min(cameraIntroMs / 900, 1);
        const eased = 1 - (1 - linear) ** 3;
        cameraGraph.alpha = -1.46 + (-Math.PI / 2 + 1.46) * eased;
        cameraGraph.beta = 0.82 + 0.1 * eased;
        cameraGraph.radius = 13.2 - 1.4 * eased;
      });
    },
    dispose(): void {
      adapter.setRenderLoop(false);
      dprQuery?.removeEventListener("change", handleDprChange);
      dprQuery = null;
      for (const piece of pieces.values()) destroyPiece(piece);
      pieces.clear();
      presentationHighlight?.dispose();
      presentationHighlight = null;
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
      const contained = containedIds(view);
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
        refreshHighlight(id);
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
    projectToTable(x: number, y: number) {
      if (scene === null || cameraGraph === null || canvas === null || x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight) return null;
      const ray = new Ray(Vector3.Zero(), Vector3.Down());
      scene.createPickingRayToRef(x, y, Matrix.Identity(), ray, cameraGraph);
      const point = Vector3.Zero();
      return intersectRayWithHorizontalPlaneToRef(ray, TABLE_SURFACE_Y, point) ? { x: point.x, y: point.y, z: point.z } : null;
    },
    isGrabbable(entityId: string): boolean {
      return pieces.get(entityId)?.drag !== undefined && isEntityGrabbable(entityId);
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
      if (kind === "held" || kind === "locked") {
        const targets = highlights[kind];
        if (entityId === null) {
          const previous = [...targets];
          targets.clear();
          for (const id of previous) refreshHighlight(id);
        } else {
          targets.add(entityId);
          refreshHighlight(entityId);
        }
        return;
      }
      const previous = highlights[kind];
      highlights[kind] = entityId;
      if (previous !== null) refreshHighlight(previous);
      if (entityId !== null) refreshHighlight(entityId);
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
