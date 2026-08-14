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

import type { RoomClient } from "../net/roomClient";
import type { KernelStore } from "../state/kernelStore";
import { attachDragBehavior } from "./dragBehavior";
import { TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH, buildCamera, buildLighting, buildTableSurface } from "./table";

interface PieceGraph { mesh: Mesh; signature: string; detachDrag?: () => void; label?: DynamicTexture; }

function displaySignature(entity: EntityRecord): string {
  const { card, die, counter } = entity.components;
  if (card !== undefined) return `card:${card.definitionId}:${card.faceUp}`;
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

function applyTransform(mesh: Mesh, transform?: TransformComponent): void {
  if (transform === undefined) return;
  mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
  mesh.scaling.set(transform.scale.x, transform.scale.y, transform.scale.z);
  mesh.rotationQuaternion = new Quaternion(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
}

export function useBabylonScene(canvasRef: RefObject<HTMLCanvasElement>, store: KernelStore, client: RoomClient, interactionsPaused: boolean): void {
  const pausedRef = useRef(interactionsPaused);
  pausedRef.current = interactionsPaused;
  useEffect(() => {
    const canvas = canvasRef.current; if (canvas === null) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    const scene = new Scene(engine); scene.clearColor = Color4.FromHexString("#08110eff");
    const camera = buildCamera(scene, canvas); const table = buildTableSurface(scene); const { shadows } = buildLighting(scene); table.receiveShadows = true;
    const pieces = new Map<string, PieceGraph>();

    function destroyPiece(piece: PieceGraph) { piece.detachDrag?.(); piece.label?.dispose(); piece.mesh.dispose(false, true); }
    function makePiece(entity: EntityRecord): PieceGraph | null {
      const { components } = entity; let mesh: Mesh; let label = ""; let color = "#d7b26d"; let width = 0.9; let depth = 0.9; let height = 0.18;
      if (components.card !== undefined) {
        width = 0.86; depth = 1.22; height = 0.09;
        const definition = store.getSnapshot().definitions[components.card.definitionId];
        label = components.card.faceUp ? definition?.label ?? components.card.definitionId : "DIGIPOLOGY";
        color = components.card.faceUp ? definition?.color ?? "#e7dfc8" : "#9e402d";
      } else if (components.die !== undefined) { width = depth = height = 0.72; label = String(components.die.value); color = "#e8dfc9"; }
      else if (components.counter !== undefined) { width = depth = 0.72; height = 0.2; label = String(components.counter.value); color = "#d5ff76"; }
      else return null;
      mesh = MeshBuilder.CreateBox(`entity-${entity.id}`, { width, depth, height }, scene); mesh.metadata = { entityId: entity.id }; mesh.isPickable = true; mesh.material = material(scene, entity.id, color); applyTransform(mesh, components.transform);
      if (components.transform === undefined) mesh.position.y = TABLE_SURFACE_Y + height / 2;
      shadows.addShadowCaster(mesh);
      const graph: PieceGraph = { mesh, signature: displaySignature(entity), ...(label ? { label: labelPlane(scene, mesh, label, width * 0.78, depth * 0.46, components.counter !== undefined) } : {}) };
      if (components.grabbable?.enabled === true) graph.detachDrag = attachDragBehavior({
        scene, camera, canvas: canvas as HTMLCanvasElement, mesh, bounds: { minX: -TABLE_WIDTH / 2 + width / 2, maxX: TABLE_WIDTH / 2 - width / 2, minZ: -TABLE_DEPTH / 2 + depth / 2, maxZ: TABLE_DEPTH / 2 - depth / 2, restingY: TABLE_SURFACE_Y + height / 2 },
        canInteract: () => !pausedRef.current,
        onGrab: () => { if (!pausedRef.current) client.sendAction({ type: "entity.grab", payload: { entityId: entity.id } }); },
        onDrop: (position) => { if (!pausedRef.current) client.sendAction({ type: "entity.drop", payload: { entityId: entity.id, transform: { position, rotation: components.transform?.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, scale: components.transform?.scale ?? { x: 1, y: 1, z: 1 } } } }); },
      });
      return graph;
    }
    function sync() {
      const state = store.getSnapshot().state; if (state === null) return;
      const ids = Object.keys(state.entities).sort();
      for (const [id, piece] of pieces) if (!(id in state.entities)) { destroyPiece(piece); pieces.delete(id); }
      for (const id of ids) {
        const entity = state.entities[id]; if (entity === undefined) continue;
        const existing = pieces.get(id);
        if (existing === undefined) { const created = makePiece(entity); if (created !== null) pieces.set(id, created); }
        else if (existing.signature !== displaySignature(entity)) { destroyPiece(existing); const created = makePiece(entity); if (created === null) pieces.delete(id); else pieces.set(id, created); }
        else applyTransform(existing.mesh, entity.components.transform);
      }
    }
    const unsubscribe = store.subscribe(sync); sync();
    const pointer = scene.onPointerObservable.add((info) => {
      if (pausedRef.current || (info.type !== PointerEventTypes.POINTERDOUBLETAP && !(info.type === PointerEventTypes.POINTERDOWN && (info.event as PointerEvent).button === 2))) return;
      const entityId = (info.pickInfo?.pickedMesh?.metadata as { entityId?: unknown } | null)?.entityId;
      if (typeof entityId === "string") client.sendAction({ type: "entity.flip", payload: { entityId } });
    });
    const render = () => scene.render(); engine.runRenderLoop(render);
    const resize = new ResizeObserver(() => engine.resize()); resize.observe(canvas);
    return () => { unsubscribe(); resize.disconnect(); for (const piece of pieces.values()) destroyPiece(piece); scene.onPointerObservable.remove(pointer); camera.detachControl(); engine.stopRenderLoop(render); scene.dispose(); engine.dispose(); };
  }, [canvasRef, client, store]);

}
