import { useEffect, useRef, type RefObject } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Scene } from "@babylonjs/core/scene";
import type { EntityRecord, TransformComponent } from "digipology-kernel";

import type { TableActionSender } from "./TableScene";
import type { KernelStore } from "../state/kernelStore";
import { attachDragBehavior } from "./dragBehavior";
import { TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH, buildCamera, buildLighting, buildTableSurface } from "./table";

type PieceDragBounds = Parameters<typeof attachDragBehavior>[0]["bounds"];

interface PieceGraph {
  mesh: Mesh;
  signature: string;
  transformSignature: string;
  restingY: number;
  dragBounds?: PieceDragBounds;
  detachDrag?: () => void;
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
  try { result.diffuseColor = Color3.FromHexString(color); }
  catch { result.diffuseColor = Color3.FromHexString("#d7b26d"); }
  result.specularColor = Color3.FromHexString("#271d10"); result.roughness = 0.72;
  return result;
}

function labelPlane(scene: Scene, parent: Mesh, text: string, width: number, height: number, billboard = false): DynamicTexture {
  const texture = new DynamicTexture(`${parent.name}-label`, { width: 512, height: 256 }, scene, false);
  texture.hasAlpha = true; texture.drawText(text.slice(0, 28), null, 150, "bold 54px Manrope", "#102018", "transparent", true, true);
  const mat = new StandardMaterial(`${parent.name}-label-material`, scene); mat.diffuseTexture = texture; mat.opacityTexture = texture; mat.emissiveColor = Color3.FromHexString("#dce8d8");
  const plane = MeshBuilder.CreatePlane(`${parent.name}-label-plane`, { width, height }, scene); plane.parent = parent; plane.position.y = billboard ? 0.68 : 0.052; plane.rotation.x = billboard ? 0 : Math.PI / 2; plane.billboardMode = billboard ? Mesh.BILLBOARDMODE_ALL : Mesh.BILLBOARDMODE_NONE; plane.material = mat; plane.isPickable = false;
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

function animateTransform(scene: Scene, mesh: Mesh, transform: TransformComponent | undefined, restingY: number): () => void {
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

export function useBabylonScene(canvasRef: RefObject<HTMLCanvasElement>, store: KernelStore, client: TableActionSender | null, interactionsPaused: boolean): void {
  const pausedRef = useRef(interactionsPaused);
  pausedRef.current = interactionsPaused;
  useEffect(() => {
    const canvas = canvasRef.current; if (canvas === null) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    const scene = new Scene(engine); scene.clearColor = Color4.FromHexString("#08110eff");
    const camera = buildCamera(scene, canvas); const table = buildTableSurface(scene); const { shadows } = buildLighting(scene); table.receiveShadows = true;
    const pieces = new Map<string, PieceGraph>();

    function destroyPiece(piece: PieceGraph) { piece.detachDrag?.(); piece.cancelCorrection?.(); piece.label?.dispose(); piece.mesh.dispose(false, true); }
    function attachPieceDrag(piece: PieceGraph, entityId: string, bounds: PieceDragBounds): void {
      if (client === null) return;
      piece.dragBounds = bounds;
      piece.detachDrag = attachDragBehavior({
        scene, camera, canvas: canvas as HTMLCanvasElement, mesh: piece.mesh, bounds,
        canInteract: () => !pausedRef.current,
        onGrab: () => { if (!pausedRef.current) client.sendAction({ type: "entity.grab", payload: { entityId } }); },
        onDrop: (position) => {
          if (pausedRef.current) return;
          const transform = store.getSnapshot().displayedState?.entities[entityId]?.components.transform;
          client.sendAction({ type: "entity.drop", payload: { entityId, transform: { position, rotation: transform?.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, scale: transform?.scale ?? { x: 1, y: 1, z: 1 } } } });
        },
      });
    }
    function makePiece(entity: EntityRecord): PieceGraph | null {
      const { components } = entity; let mesh: Mesh; let label = ""; let color = "#d7b26d"; let width = 0.9; let depth = 0.9; let height = 0.18;
      if (components.card !== undefined) {
        width = 0.86; depth = 1.22; height = 0.09;
        const definition = store.getSnapshot().definitions[components.card.definitionId];
        const faceUp = cardFaceUp(entity);
        label = faceUp ? definition?.label ?? components.card.definitionId : "DIGIPOLOGY";
        color = faceUp ? definition?.color ?? "#e7dfc8" : "#9e402d";
      } else if (components.die !== undefined) { width = depth = height = 0.72; label = String(components.die.value); color = "#e8dfc9"; }
      else if (components.counter !== undefined) { width = depth = 0.72; height = 0.2; label = String(components.counter.value); color = "#d5ff76"; }
      else return null;
      const restingY = TABLE_SURFACE_Y + height / 2;
      mesh = MeshBuilder.CreateBox(`entity-${entity.id}`, { width, depth, height }, scene); mesh.metadata = { entityId: entity.id }; mesh.isPickable = true; mesh.material = material(scene, entity.id, color); applyTransform(mesh, components.transform, restingY);
      shadows.addShadowCaster(mesh);
      const graph: PieceGraph = { mesh, signature: displaySignature(entity), transformSignature: transformSignature(components.transform, restingY), restingY, ...(label ? { label: labelPlane(scene, mesh, label, width * 0.78, depth * 0.46, components.counter !== undefined) } : {}) };
      if (client !== null && components.grabbable?.enabled === true) attachPieceDrag(graph, entity.id, { minX: -TABLE_WIDTH / 2 + width / 2, maxX: TABLE_WIDTH / 2 - width / 2, minZ: -TABLE_DEPTH / 2 + depth / 2, maxZ: TABLE_DEPTH / 2 - depth / 2, restingY });
      return graph;
    }
    let lastDisplayedState: ReturnType<KernelStore["getSnapshot"]>["displayedState"] = null;
    let lastDefinitions: ReturnType<KernelStore["getSnapshot"]>["definitions"] | null = null;
    let lastCorrectionId: number | null = null;
    function sync() {
      const view = store.getSnapshot();
      const state = view.displayedState;
      const correctionId = view.correction?.id ?? null;
      if (state === null) return;
      if (state === lastDisplayedState && view.definitions === lastDefinitions && correctionId === lastCorrectionId) return;
      lastDisplayedState = state; lastDefinitions = view.definitions; lastCorrectionId = correctionId;
      const ids = Object.keys(state.entities).sort();
      for (const [id, piece] of pieces) if (!(id in state.entities)) { destroyPiece(piece); pieces.delete(id); }
      for (const id of ids) {
        const entity = state.entities[id]; if (entity === undefined) continue;
        const existing = pieces.get(id);
        if (existing === undefined) { const created = makePiece(entity); if (created !== null) pieces.set(id, created); }
        else if (existing.signature !== displaySignature(entity)) { destroyPiece(existing); const created = makePiece(entity); if (created === null) pieces.delete(id); else pieces.set(id, created); }
        else {
          const nextTransformSignature = transformSignature(entity.components.transform, existing.restingY);
          const correction = view.correction?.entityId === id && existing.lastCorrectionId !== view.correction.id
            ? view.correction
            : null;
          if (correction !== null) {
            existing.lastCorrectionId = correction.id;
            existing.detachDrag?.(); delete existing.detachDrag;
            existing.cancelCorrection?.();
            existing.cancelCorrection = animateTransform(scene, existing.mesh, entity.components.transform, existing.restingY);
            if (existing.dragBounds !== undefined && entity.components.grabbable?.enabled === true) {
              attachPieceDrag(existing, entity.id, existing.dragBounds);
            }
          } else if (existing.transformSignature !== nextTransformSignature) {
            existing.cancelCorrection?.(); delete existing.cancelCorrection;
            applyTransform(existing.mesh, entity.components.transform, existing.restingY);
          }
          existing.transformSignature = nextTransformSignature;
        }
      }
    }
    const unsubscribe = store.subscribe(sync); sync();
    const pointer = scene.onPointerObservable.add((info) => {
      if (client === null || pausedRef.current || (info.type !== PointerEventTypes.POINTERDOUBLETAP && !(info.type === PointerEventTypes.POINTERDOWN && (info.event as PointerEvent).button === 2))) return;
      const entityId = (info.pickInfo?.pickedMesh?.metadata as { entityId?: unknown } | null)?.entityId;
      if (typeof entityId === "string") client.sendAction({ type: "entity.flip", payload: { entityId } });
    });
    const render = () => scene.render(); engine.runRenderLoop(render);
    const resize = new ResizeObserver(() => engine.resize()); resize.observe(canvas);
    return () => { unsubscribe(); resize.disconnect(); for (const piece of pieces.values()) destroyPiece(piece); scene.onPointerObservable.remove(pointer); camera.detachControl(); engine.stopRenderLoop(render); scene.dispose(); engine.dispose(); };
  }, [canvasRef, client, store]);

}
