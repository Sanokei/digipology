import { Engine } from "@babylonjs/core/Engines/engine";
import { Ray } from "@babylonjs/core/Culling/ray.core";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { faceSpecHash, renderFaceCanvas, type Canvas2DLike } from "digipology-faces";
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
  PresentationSettings,
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
  type TableGraph,
} from "./table";
import { piecePresentation, piecePresentationSignature, seatColor } from "./piecePresentation";
import { projectWorldToScreen } from "./cameraProjection";
import { defaultPresentationSettings } from "./presentationSettings";
import { easeOutCubic, tumbleQuaternion } from "./presentationMotion";

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
  cancelSemantic?: () => void;
  faceKey?: string;
  faceMaterial?: StandardMaterial;
  children?: Mesh[];
  contactShadow?: Mesh;
}

interface WebglSceneAdapterDependencies extends SceneAdapterDependencies {
  createEngine?: (
    canvas: HTMLCanvasElement,
    antialias: boolean,
    options: ConstructorParameters<typeof Engine>[2],
  ) => Engine;
  createLabelTexture?: (name: string, scene: Scene) => DynamicTexture;
  createFaceTexture?: (name: string, scene: Scene) => DynamicTexture;
  createHighlightLayer?: HighlightLayerFactory;
  matchMedia?: (query: string) => MediaQueryList;
  devicePixelRatio?: () => number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function pickedEntityId(mesh: { metadata?: unknown; parent?: unknown } | null | undefined): string | null {
  let current: { metadata?: unknown; parent?: unknown } | null | undefined = mesh;
  while (current !== null && current !== undefined) {
    const entityId = (current.metadata as { entityId?: unknown } | null)?.entityId;
    if (typeof entityId === "string") return entityId;
    current = current.parent as { metadata?: unknown; parent?: unknown } | null | undefined;
  }
  return null;
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
  result.roughness = appearance.materialKind === "plastic" ? 0.5
    : appearance.materialKind === "metal" ? 0.28
      : appearance.materialKind === "card-stock" ? 0.72
        : appearance.materialKind === "stone" ? 0.9 : 0.78;
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
  duration = 220,
): () => void {
  const fromPosition = mesh.position.clone();
  const fromScaling = mesh.scaling.clone();
  const fromRotation = mesh.rotationQuaternion?.clone() ?? Quaternion.Identity();
  const target = transformTarget(transform, restingY);
  mesh.rotationQuaternion ??= Quaternion.Identity();
  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime();
    const linear = Math.min(elapsed / duration, 1);
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

function animateSemanticRotation(scene: Scene, mesh: Mesh, kind: "flip" | "tumble"): () => void {
  const target = mesh.rotationQuaternion?.clone() ?? Quaternion.Identity();
  const from = kind === "flip"
    ? Quaternion.RotationAxis(Vector3.Forward(), Math.PI).multiply(target)
    : target;
  mesh.rotationQuaternion ??= Quaternion.Identity();
  let elapsed = 0;
  const duration = kind === "flip" ? 250 : 720;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime();
    const linear = Math.min(elapsed / duration, 1);
    if (kind === "tumble") {
      const next = tumbleQuaternion([target.x, target.y, target.z, target.w], linear);
      mesh.rotationQuaternion!.set(next[0], next[1], next[2], next[3]);
    } else {
      Quaternion.SlerpToRef(from, target, easeOutCubic(linear), mesh.rotationQuaternion!);
    }
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
  let tableGraph: TableGraph | null = null;
  let snapGhost: Mesh | null = null;
  let settings: PresentationSettings = dependencies.settings?.getSnapshot() ?? defaultPresentationSettings(false);
  let unsubscribeSettings: (() => void) | null = null;
  let frameSamples = 0;
  let frameElapsed = 0;
  let measuredFps = 0;
  let topDown = false;
  let contactShadowsEnabled = true;
  let seatRadius = 11.8;
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
  const faceTextures = new Map<string, { texture: DynamicTexture; references: number }>();
  const highlights = {
    hover: null as string | null,
    selected: new Set<string>(),
    held: new Set<string>(),
    locked: new Set<string>(),
  };

  function refreshHighlight(entityId: string): void {
    const piece = pieces.get(entityId);
    if (piece === undefined || presentationHighlight === null) return;
    presentationHighlight.removeMesh(piece.mesh);
    const kind: HighlightKind | undefined = highlights.held.has(entityId) ? "held"
      : highlights.locked.has(entityId) ? "locked"
        : highlights.selected.has(entityId) ? "selected"
          : highlights.hover === entityId ? "hover" : undefined;
    if (kind === undefined) return;
    const colors: Record<HighlightKind, Color3> = {
      hover: Color3.FromHexString("#f7d89b"), selected: Color3.FromHexString("#f7d89b"),
      held: Color3.FromHexString("#fff2be"), locked: Color3.FromHexString("#ff9f7a"),
    };
    if (kind === "held") {
      const heldBy = currentView?.displayedState?.entities[entityId]?.components.grabbable?.heldBy;
      if (heldBy !== null && heldBy !== undefined) {
        const seat = currentView?.players.find((player) => player.playerId === heldBy)?.seatId ?? heldBy;
        colors.held = Color3.FromHexString(seatColor(seat));
      }
    }
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
    if (piece.faceMaterial !== undefined) {
      piece.faceMaterial.diffuseTexture = null;
      piece.faceMaterial.emissiveTexture = null;
      piece.faceMaterial.dispose();
    }
    if (piece.faceKey !== undefined) {
      const cached = faceTextures.get(piece.faceKey);
      if (cached !== undefined) {
        cached.references -= 1;
        if (cached.references === 0) {
          cached.texture.dispose();
          faceTextures.delete(piece.faceKey);
        }
      }
    }
    piece.cancelMotion?.();
    piece.cancelSemantic?.();
    piece.contactShadow?.dispose(false, true);
    presentationHighlight?.removeMesh(piece.mesh);
    piece.mesh.dispose(false, true);
  }

  function addFace(graph: PieceGraph, parent: Mesh, appearance: ReturnType<typeof piecePresentation>): void {
    if (appearance.face === undefined) return;
    const mounted = requireMounted();
    const key = faceSpecHash(appearance.face);
    let cached = faceTextures.get(key);
    if (cached === undefined) {
      const texture = dependencies.createFaceTexture?.(`face-${key}`, mounted.scene)
        ?? new DynamicTexture(`face-${key}`, { width: 1024, height: 1024 }, mounted.scene, false);
      texture.hasAlpha = true;
      renderFaceCanvas(texture.getContext() as unknown as Canvas2DLike, appearance.face, 1024, 1024);
      texture.update(false);
      cached = { texture, references: 0 };
      faceTextures.set(key, cached);
    }
    cached.references += 1;
    const faceMaterial = new StandardMaterial(`${parent.name}-face-material`, mounted.scene);
    faceMaterial.diffuseTexture = cached.texture;
    faceMaterial.emissiveTexture = cached.texture;
    faceMaterial.disableLighting = true;
    faceMaterial.backFaceCulling = false;
    const plane = CreatePlane(`${parent.name}-face-plane`, { width: appearance.width * 0.98, height: appearance.depth * 0.98 }, mounted.scene);
    plane.parent = parent;
    plane.position.y = appearance.height / 2 + 0.004;
    plane.rotation.x = Math.PI / 2;
    plane.material = faceMaterial;
    plane.isPickable = false;
    graph.faceKey = key;
    graph.faceMaterial = faceMaterial;
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
      onGrab() {
        dependencies.audio?.play("piece-pick");
        actionCallbacks.onGrab();
      },
      onDrop(position, rotation) {
        piece.cancelMotion?.();
        piece.cancelMotion = animateLanding(mounted.scene, piece.mesh);
        dependencies.audio?.play("piece-place");
        actionCallbacks.onDrop(position, rotation);
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
    const definitionId = components.appearance?.definitionId ?? components.card?.definitionId ?? components.die?.definitionId;
    const definition = definitionId === undefined ? undefined : currentView?.definitions[definitionId];
    const appearance = piecePresentation(
      entity,
      definition,
    );
    const restingY = TABLE_SURFACE_Y + appearance.height / 2;
    let roundedChildren: Mesh[] = [];
    const makeRoundedSlab = (): Mesh => {
      const radius = Math.min(appearance.cornerRadius, appearance.width * 0.24, appearance.depth * 0.24);
      const root = CreateBox(`entity-${entity.id}`, {
        width: Math.max(appearance.width - radius * 2, radius), depth: appearance.depth, height: appearance.height,
      }, mounted.scene);
      const cross = CreateBox(`${root.name}-round-cross`, {
        width: appearance.width, depth: Math.max(appearance.depth - radius * 2, radius), height: appearance.height,
      }, mounted.scene);
      cross.parent = root;
      roundedChildren.push(cross);
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        const corner = CreateCylinder(`${root.name}-corner-${x}-${z}`, {
          height: appearance.height, diameter: radius * 2, tessellation: 18,
        }, mounted.scene);
        corner.parent = root;
        corner.position.set(x * (appearance.width / 2 - radius), 0, z * (appearance.depth / 2 - radius));
        roundedChildren.push(corner);
      }
      return root;
    };
    const mesh = appearance.shape === "card" || appearance.shape === "board" || appearance.shape === "box" || appearance.shape === "cube"
      ? makeRoundedSlab()
      : appearance.shape === "ring"
      ? CreateTorus(`entity-${entity.id}`, {
          diameter: appearance.width,
          thickness: appearance.height,
          tessellation: 48,
        }, mounted.scene)
      : ["cylinder", "disc", "token", "hex", "pawn", "meeple"].includes(appearance.shape)
      ? CreateCylinder(`entity-${entity.id}`, {
          height: appearance.shape === "pawn" || appearance.shape === "meeple" ? appearance.height * 0.72 : appearance.height,
          diameter: appearance.width,
          ...(appearance.shape === "hex" ? { tessellation: 6 }
            : appearance.shape === "pawn" ? { tessellation: 24, diameterTop: appearance.width * 0.38, diameterBottom: appearance.width }
            : appearance.shape === "meeple" ? { tessellation: 8, diameterTop: appearance.width, diameterBottom: appearance.width * 0.62 }
            : { tessellation: 48 }),
        }, mounted.scene)
      : CreateBox(`entity-${entity.id}`, {
          width: appearance.width,
          depth: appearance.depth,
          height: appearance.height,
        }, mounted.scene);
    mesh.metadata = { entityId: entity.id, displayLabel: appearance.label };
    mesh.isPickable = true;
    mesh.material = material(mounted.scene, entity.id, appearance);
    for (const child of roundedChildren) {
      child.material = mesh.material;
      child.isPickable = true;
      shadows?.addShadowCaster(child);
    }
    applyTransform(mesh, components.transform, restingY);
    shadows?.addShadowCaster(mesh);
    const graph: PieceGraph = {
      mesh,
      signature: piecePresentationSignature(entity, definition),
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
    if (roundedChildren.length > 0) graph.children = roundedChildren;
    if (contactShadowsEnabled) {
      const contactMaterial = new StandardMaterial(`${mesh.name}-contact-material`, mounted.scene);
      contactMaterial.diffuseColor = Color3.Black();
      contactMaterial.emissiveColor = Color3.Black();
      contactMaterial.specularColor = Color3.Black();
      contactMaterial.alpha = 0.2;
      contactMaterial.disableLighting = true;
      const contactShadow = CreateDisc(`${mesh.name}-contact-shadow`, {
        radius: Math.max(appearance.width, appearance.depth) * 0.42,
        tessellation: 24,
      }, mounted.scene);
      contactShadow.rotation.x = Math.PI / 2;
      contactShadow.position.set(mesh.position.x, TABLE_SURFACE_Y + 0.003, mesh.position.z);
      contactShadow.scaling.y = Math.max(appearance.depth / Math.max(appearance.width, 0.01), 0.45);
      contactShadow.material = contactMaterial;
      contactShadow.isPickable = false;
      graph.contactShadow = contactShadow;
    }
    if (appearance.shape === "pawn" || appearance.shape === "meeple") {
      const head = CreateSphere(`entity-${entity.id}-head`, {
        diameter: appearance.width * (appearance.shape === "pawn" ? 0.5 : 0.42),
        segments: 20,
      }, mounted.scene);
      head.parent = mesh;
      head.position.y = appearance.height * 0.39;
      head.material = mesh.material;
      head.isPickable = true;
      shadows?.addShadowCaster(head);
      graph.children ??= [];
      graph.children.push(head);
      if (appearance.shape === "meeple") {
        const children = graph.children;
        for (const side of [-1, 1]) {
          const arm = CreateBox(`${mesh.name}-arm-${side}`, {
            width: appearance.width * 0.42,
            depth: appearance.depth,
            height: appearance.height * 0.18,
          }, mounted.scene);
          arm.parent = mesh;
          arm.position.set(side * appearance.width * 0.38, appearance.height * 0.12, 0);
          arm.rotation.z = side * -0.35;
          arm.material = mesh.material;
          arm.isPickable = true;
          shadows?.addShadowCaster(arm);
          children.push(arm);
        }
      }
    }
    if (appearance.stackLayers > 1) {
      graph.children ??= [];
      for (let index = 1; index < appearance.stackLayers; index += 1) {
        const layer = CreateBox(`${mesh.name}-stack-${index}`, {
          width: appearance.width * 0.985,
          depth: appearance.depth * 0.985,
          height: 0.012,
        }, mounted.scene);
        layer.parent = mesh;
        layer.position.y = -appearance.height / 2 + index * appearance.height / appearance.stackLayers;
        layer.position.x = (index % 2 === 0 ? 1 : -1) * 0.008;
        layer.material = mesh.material;
        layer.isPickable = true;
        graph.children.push(layer);
      }
    }
    addFace(graph, mesh, appearance);
    if (dependencies.sendAction !== undefined && components.grabbable?.enabled === true && !appearance.isBoard) {
      attachPieceDrag(graph, entity.id, {
        minX: -TABLE_WIDTH / 2 + appearance.width / 2,
        maxX: TABLE_WIDTH / 2 - appearance.width / 2,
        minZ: -TABLE_DEPTH / 2 + appearance.depth / 2,
        maxZ: TABLE_DEPTH / 2 - appearance.depth / 2,
        restingY,
      });
    }
    if (!settings.reducedMotion) graph.cancelMotion = animateSpawn(mounted.scene, mesh);
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
    handlesDesktopDrag: false,
    async mount(nextCanvas: HTMLCanvasElement, options: SceneAdapterMountOptions): Promise<void> {
      canvas = nextCanvas;
      const highQuality = options.tier === "default";
      contactShadowsEnabled = highQuality;
      engine = dependencies.createEngine?.(
        canvas,
        highQuality,
        { preserveDrawingBuffer: false, stencil: true },
      ) ?? new Engine(canvas, highQuality, { preserveDrawingBuffer: false, stencil: true });
      handleDprChange();
      scene = new Scene(engine);
      scene.clearColor = Color4.FromHexString("#171713ff");
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.exposure = 1.08;
      scene.imageProcessingConfiguration.contrast = 1.14;
      cameraGraph = buildCamera(scene);
      seatRadius = canvas.clientWidth / Math.max(canvas.clientHeight, 1) < 0.75 ? 22 : 11.8;
      cameraGraph.alpha = -1.46;
      cameraGraph.beta = 0.82;
      cameraGraph.radius = seatRadius + 1.4;
      tableGraph = buildTableSurface(scene, settings.tableStyle);
      shadows = buildLighting(scene, highQuality).shadows;
      tableGraph.surface.receiveShadows = shadows !== null;
      unsubscribeSettings = dependencies.settings?.subscribe((next) => {
        settings = next;
        tableGraph?.setStyle(next.tableStyle);
      }) ?? null;
      presentationHighlight = dependencies.createHighlightLayer?.(scene) ?? new HighlightLayer("presentation-highlight", scene);
      let cameraIntroMs = 0;
      scene.onBeforeRenderObservable.add(() => {
        const deltaMs = scene?.getEngine().getDeltaTime() ?? 0;
        frameSamples += 1;
        frameElapsed += deltaMs;
        if (frameElapsed >= 500) {
          measuredFps = frameSamples * 1_000 / frameElapsed;
          frameSamples = 0;
          frameElapsed = 0;
        }
        for (const piece of pieces.values()) {
          if (piece.contactShadow !== undefined) {
            piece.contactShadow.position.x = piece.mesh.position.x;
            piece.contactShadow.position.z = piece.mesh.position.z;
            const lift = Math.max(0, piece.mesh.position.y - piece.restingY);
            const size = Math.max(0.58, 1 - lift * 0.75);
            piece.contactShadow.scaling.x = size;
            piece.contactShadow.scaling.z = size;
            (piece.contactShadow.material as StandardMaterial).alpha = 0.2 * size;
          }
        }
        if (cameraGraph === null || cameraIntroMs >= 900) return;
        cameraIntroMs += deltaMs;
        const linear = Math.min(cameraIntroMs / 900, 1);
        const eased = 1 - (1 - linear) ** 3;
        cameraGraph.alpha = -1.46 + (-Math.PI / 2 + 1.46) * eased;
        cameraGraph.beta = 0.82 + 0.1 * eased;
        cameraGraph.radius = seatRadius + 1.4 - 1.4 * eased;
      });
    },
    dispose(): void {
      adapter.setRenderLoop(false);
      unsubscribeSettings?.();
      unsubscribeSettings = null;
      dprQuery?.removeEventListener("change", handleDprChange);
      dprQuery = null;
      for (const piece of pieces.values()) destroyPiece(piece);
      pieces.clear();
      for (const cached of faceTextures.values()) cached.texture.dispose();
      faceTextures.clear();
      presentationHighlight?.dispose();
      presentationHighlight = null;
      scene?.dispose();
      engine?.dispose();
      activeDrag = null;
      cameraGraph = null;
      scene = null;
      engine = null;
      canvas = null;
      tableGraph = null;
      snapGhost = null;
    },
    syncEntities(view: KernelStoreSnapshot): void {
      currentView = view;
      const state = view.displayedState;
      const correctionId = view.correction?.id ?? null;
      if (state === null) return;
      if (state === lastDisplayedState && view.definitions === lastDefinitions && correctionId === lastCorrectionId) return;
      const previousState = lastDisplayedState;
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
          if (created !== null) {
            pieces.set(id, created);
            const previousContainer = Object.values(previousState?.entities ?? {}).find((candidate) => candidate.components.container?.items.includes(id) === true);
            const origin = previousContainer?.components.transform?.position;
            if (!settings.reducedMotion && scene !== null && entity.components.card !== undefined && origin !== undefined) {
              created.mesh.position.set(origin.x, origin.y + 0.35, origin.z);
              created.cancelCorrection = animateTransform(scene, created.mesh, entity.components.transform, created.restingY, 420);
              dependencies.audio?.play("card-slide");
            }
          }
        } else {
          const definitionId = entity.components.appearance?.definitionId ?? entity.components.card?.definitionId ?? entity.components.die?.definitionId;
          const definition = definitionId === undefined ? undefined : view.definitions[definitionId];
          if (existing.signature !== piecePresentationSignature(entity, definition)) {
          if (entity.components.card !== undefined) dependencies.audio?.play("card-flip");
          else if (entity.components.die !== undefined) {
            dependencies.audio?.play("dice-rattle");
            dependencies.audio?.play("dice-land");
          } else if (entity.components.deck !== undefined) dependencies.audio?.play("deck-shuffle");
          else if (entity.components.counter !== undefined) dependencies.audio?.play("chip-clink");
          destroyPiece(existing);
          const created = makePiece(entity);
          if (created === null) pieces.delete(id);
          else {
            pieces.set(id, created);
            if (!settings.reducedMotion && scene !== null && entity.components.die !== undefined) {
              created.cancelSemantic = animateSemanticRotation(scene, created.mesh, "tumble");
            } else if (!settings.reducedMotion && scene !== null && entity.components.card !== undefined) {
              created.cancelSemantic = animateSemanticRotation(scene, created.mesh, "flip");
            }
          }
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
            if (settings.reducedMotion) applyTransform(existing.mesh, entity.components.transform, existing.restingY);
            else existing.cancelCorrection = animateTransform(scene, existing.mesh, entity.components.transform, existing.restingY, 180);
            if (existing.dragBounds !== undefined && entity.components.grabbable?.enabled === true) {
              attachPieceDrag(existing, entity.id, existing.dragBounds);
            }
          } else if (existing.transformSignature !== nextTransformSignature) {
            existing.cancelCorrection?.();
            if (settings.reducedMotion || scene === null) {
              delete existing.cancelCorrection;
              applyTransform(existing.mesh, entity.components.transform, existing.restingY);
            } else {
              existing.cancelCorrection = animateTransform(scene, existing.mesh, entity.components.transform, existing.restingY);
            }
          }
          existing.transformSignature = nextTransformSignature;
          }
        }
        refreshHighlight(id);
      }
    },
    async pick(x: number, y: number): Promise<string | null> {
      if (scene === null) return null;
      const result = scene.pick(x, y, (mesh) => {
        const entityId = pickedEntityId(mesh);
        return entityId !== null && pieces.has(entityId);
      });
      return pickedEntityId(result?.pickedMesh);
    },
    projectToTable(x: number, y: number) {
      if (scene === null || cameraGraph === null || canvas === null || x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight) return null;
      const ray = new Ray(Vector3.Zero(), Vector3.Down());
      scene.createPickingRayToRef(x, y, Matrix.Identity(), ray, cameraGraph);
      const point = Vector3.Zero();
      return intersectRayWithHorizontalPlaneToRef(ray, TABLE_SURFACE_Y, point) ? { x: point.x, y: point.y, z: point.z } : null;
    },
    projectFromTable(point) {
      if (cameraGraph === null || canvas === null) return null;
      return projectWorldToScreen(cameraGraph, canvas.clientWidth, canvas.clientHeight, point);
    },
    isGrabbable(entityId: string): boolean {
      return pieces.get(entityId)?.drag !== undefined && isEntityGrabbable(entityId);
    },
    beginDrag(entityId: string, pointerId: number, x: number, y: number): void {
      const drag = pieces.get(entityId)?.drag;
      if (drag === undefined) return;
      activeDrag = { entityId, pointerId };
      drag.beginTouchDrag(pointerId, x, y);
    },
    updateDrag(pointerId: number, x: number, y: number): void {
      if (activeDrag?.pointerId !== pointerId) return;
      pieces.get(activeDrag.entityId)?.drag?.moveTouchDrag(pointerId, x, y);
    },
    rotateDrag(radians: number): void {
      if (activeDrag === null) return;
      pieces.get(activeDrag.entityId)?.drag?.rotateDrag(radians);
    },
    flipDrag(): void {
      if (activeDrag === null) return;
      pieces.get(activeDrag.entityId)?.drag?.flipDrag();
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
      if (kind === "held" || kind === "locked" || kind === "selected") {
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
      if (kind === "selected") {
        const previous = [...highlights.selected];
        highlights.selected.clear();
        if (entityId !== null) highlights.selected.add(entityId);
        for (const id of previous) refreshHighlight(id);
        if (entityId !== null) refreshHighlight(entityId);
        return;
      }
      const previous = highlights.hover;
      highlights.hover = entityId;
      if (previous !== null) refreshHighlight(previous);
      if (entityId !== null) refreshHighlight(entityId);
    },
    setSelection(ids): void {
      const previous = [...highlights.selected];
      highlights.selected = new Set(ids);
      for (const id of new Set([...previous, ...ids])) refreshHighlight(id);
    },
    showSnapGhost(entityId, pose): void {
      if (scene === null) return;
      snapGhost?.dispose(false, true);
      const source = pieces.get(entityId)?.mesh;
      const extent = source?.getBoundingInfo().boundingBox.extendSizeWorld;
      const ghost = CreateBox("snap-ghost", {
        width: Math.max((extent?.x ?? 0.35) * 2, 0.08),
        height: Math.max((extent?.y ?? 0.04) * 2, 0.04),
        depth: Math.max((extent?.z ?? 0.35) * 2, 0.08),
      }, scene);
      ghost.metadata = null;
      ghost.isPickable = false;
      const ghostMaterial = new StandardMaterial("snap-ghost-material", scene);
      ghostMaterial.diffuseColor = Color3.FromHexString("#9dffcf");
      ghostMaterial.emissiveColor = Color3.FromHexString("#1d6d4a");
      ghostMaterial.alpha = 0.34;
      ghost.material = ghostMaterial;
      ghost.position.set(pose.position.x, pose.position.y, pose.position.z);
      if (pose.rotation !== undefined) ghost.rotationQuaternion = new Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      if (pose.scale !== undefined) ghost.scaling.set(pose.scale.x, pose.scale.y, pose.scale.z);
      snapGhost = ghost;
    },
    clearSnapGhost(): void {
      snapGhost?.dispose(false, true);
      snapGhost = null;
    },
    getPerformanceStats() {
      return { fps: measuredFps, visiblePieces: pieces.size, textureCount: faceTextures.size };
    },
    camera: {
      attach(): void {},
      detach(): void {},
      orbit(dx: number, dy: number): void {
        if (cameraGraph === null) return;
        cameraGraph.alpha -= dx / 900;
        cameraGraph.beta = clamp(cameraGraph.beta - dy / 900, 0.38, 1.32);
      },
      pan(dx: number, dy: number): void {
        if (cameraGraph === null) return;
        const scale = cameraGraph.radius / 1_100;
        const rightX = -Math.sin(cameraGraph.alpha);
        const rightZ = Math.cos(cameraGraph.alpha);
        const forwardX = -Math.cos(cameraGraph.alpha);
        const forwardZ = -Math.sin(cameraGraph.alpha);
        cameraGraph.target.x -= rightX * dx * scale + forwardX * dy * scale;
        cameraGraph.target.z -= rightZ * dx * scale + forwardZ * dy * scale;
        cameraGraph.target.x = clamp(cameraGraph.target.x, -3.25, 3.25);
        cameraGraph.target.z = clamp(cameraGraph.target.z, -2.35, 2.35);
      },
      pinch(previousDistance: number, distance: number): void {
        if (cameraGraph === null || previousDistance <= 0 || distance <= 0) return;
        cameraGraph.radius = clamp(cameraGraph.radius * previousDistance / distance, 7.3, 24);
      },
      zoom(deltaY: number, cursorX?: number, cursorY?: number): void {
        if (cameraGraph === null) return;
        const focus = cursorX === undefined || cursorY === undefined ? null : adapter.projectToTable(cursorX, cursorY);
        cameraGraph.radius = clamp(cameraGraph.radius * Math.exp(deltaY * 0.001), 7.3, 24);
        if (focus !== null && deltaY < 0) {
          cameraGraph.target.x = clamp(cameraGraph.target.x + (focus.x - cameraGraph.target.x) * 0.08, -3.25, 3.25);
          cameraGraph.target.z = clamp(cameraGraph.target.z + (focus.z - cameraGraph.target.z) * 0.08, -2.35, 2.35);
        }
      },
      reset(seatIndex = 0): void {
        if (cameraGraph === null) return;
        cameraGraph.alpha = -Math.PI / 2 + seatIndex * Math.PI / 2;
        cameraGraph.beta = 0.92;
        cameraGraph.radius = seatRadius;
        cameraGraph.target.set(0, 0, 0);
        cameraGraph.inertialAlphaOffset = 0;
        cameraGraph.inertialBetaOffset = 0;
        cameraGraph.inertialRadiusOffset = 0;
        topDown = false;
      },
      toggleTopDown(): void {
        if (cameraGraph === null) return;
        topDown = !topDown;
        cameraGraph.beta = topDown ? 0.08 : 0.92;
        cameraGraph.radius = topDown ? Math.max(13.8, seatRadius) : seatRadius;
      },
    },
    setPaused(nextPaused: boolean): void {
      if (nextPaused && activeDrag !== null) adapter.cancelDrag(activeDrag.pointerId);
      paused = nextPaused;
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
