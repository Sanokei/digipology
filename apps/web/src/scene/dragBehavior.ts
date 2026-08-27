import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Ray } from "@babylonjs/core/Culling/ray.core";
// Patches Scene with the picking methods used by pointer and touch dragging.
import "@babylonjs/core/Culling/ray";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
// Registers effect-layer render stages with Scene; HighlightLayer construction otherwise throws.
import "@babylonjs/core/Layers/effectLayerSceneComponent";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

import { intersectRayWithHorizontalPlaneToRef, type Vector3Like } from "./dragPlane";
import { flipQuaternion, rotateQuaternionY } from "./interactionMath";

export {
  intersectRayWithHorizontalPlaneToRef,
  type MutableVector3Like,
  type RayLike,
  type Vector3Like,
} from "./dragPlane";

interface DragBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  restingY: number;
}

export interface HighlightLayerFacade {
  addMesh(mesh: Mesh, color: Color3): void;
  removeMesh(mesh: Mesh): void;
  dispose(): void;
}

export type HighlightLayerFactory = (scene: Scene) => HighlightLayerFacade;

interface AttachDragBehaviorOptions {
  scene: Scene;
  camera: ArcRotateCamera;
  canvas: HTMLCanvasElement;
  mesh: Mesh;
  bounds: DragBounds;
  onGrab?: () => void;
  onDrop?: (position: Vector3Like, rotation: { x: number; y: number; z: number; w: number }) => void;
  canInteract?: () => boolean;
  createHighlightLayer?: HighlightLayerFactory;
}

export interface AttachedDragBehavior {
  beginTouchDrag(pointerId: number, x: number, y: number): void;
  moveTouchDrag(pointerId: number, x: number, y: number): void;
  rotateDrag(radians: number): void;
  flipDrag(): void;
  finishTouchDrag(pointerId: number): void;
  cancelTouchDrag(pointerId: number): void;
  setTouchSelected(selected: boolean): void;
  dispose(): void;
}

const SELECTED_COLOR = Color3.FromHexString("#f7d89b");
const HELD_COLOR = Color3.FromHexString("#fff2be");
const LIFT_HEIGHT = 0.22;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Presentation-only pointer behavior. Held/hovered state is deliberately
 * transient UI state and must never be treated as canonical gameplay state.
 */
export function attachDragBehavior({
  scene,
  camera,
  canvas,
  mesh,
  bounds,
  onGrab,
  onDrop,
  canInteract,
  createHighlightLayer = (targetScene) => new HighlightLayer("grab-highlight", targetScene),
}: AttachDragBehaviorOptions): AttachedDragBehavior {
  const highlight = createHighlightLayer(scene);
  const pickingRay = new Ray(Vector3.Zero(), Vector3.Down());
  const dragPoint = Vector3.Zero();
  const identityMatrix = Matrix.Identity();
  const dragPlaneY = bounds.restingY + LIFT_HEIGHT;
  let heldPointerId: number | null = null;
  let isTouchSelected = false;
  let grabOffsetX = 0;
  let grabOffsetZ = 0;
  let origin: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  } | null = null;

  function idleHighlight(): Color3 | null {
    return isTouchSelected ? SELECTED_COLOR : null;
  }

  function setHighlight(color: Color3 | null) {
    highlight.removeMesh(mesh);
    if (color !== null) {
      highlight.addMesh(mesh, color);
    }
  }

  function finishDrag(pointerId?: number, submit = true, restore = false) {
    if (heldPointerId === null || (pointerId !== undefined && pointerId !== heldPointerId)) {
      return;
    }

    const capturedPointerId = heldPointerId;
    heldPointerId = null;
    if (restore && origin !== null) {
      mesh.position.set(origin.position.x, origin.position.y, origin.position.z);
      const quaternion = mesh.rotationQuaternion ?? Quaternion.Identity();
      quaternion.set(origin.rotation.x, origin.rotation.y, origin.rotation.z, origin.rotation.w);
      mesh.rotationQuaternion = quaternion;
    } else {
      mesh.position.x = clamp(mesh.position.x, bounds.minX, bounds.maxX);
      mesh.position.z = clamp(mesh.position.z, bounds.minZ, bounds.maxZ);
      mesh.position.y = bounds.restingY;
    }
    canvas.style.cursor = "grab";
    setHighlight(idleHighlight());

    const rotation = mesh.rotationQuaternion ?? Quaternion.Identity();
    if (submit) onDrop?.(
      { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    );
    origin = null;

    if (canvas.hasPointerCapture(capturedPointerId)) {
      canvas.releasePointerCapture(capturedPointerId);
    }
  }

  function beginDrag(pointerId: number, x: number, y: number) {
    if (heldPointerId !== null || canInteract?.() === false) return;
    const rotation = mesh.rotationQuaternion ?? Quaternion.Identity();
    origin = {
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    };
    scene.createPickingRayToRef(x, y, identityMatrix, pickingRay, camera);
    if (intersectRayWithHorizontalPlaneToRef(pickingRay, dragPlaneY, dragPoint)) {
      grabOffsetX = mesh.position.x - dragPoint.x;
      grabOffsetZ = mesh.position.z - dragPoint.z;
    } else {
      grabOffsetX = 0;
      grabOffsetZ = 0;
    }
    heldPointerId = pointerId;
    mesh.position.y = dragPlaneY;
    canvas.setPointerCapture(pointerId);
    canvas.style.cursor = "grabbing";
    setHighlight(HELD_COLOR);
    onGrab?.();
  }

  function moveDrag(pointerId: number, x: number, y: number) {
    if (heldPointerId !== pointerId) return;
    scene.createPickingRayToRef(x, y, identityMatrix, pickingRay, camera);

    if (intersectRayWithHorizontalPlaneToRef(pickingRay, dragPlaneY, dragPoint)) {
      mesh.position.x = clamp(dragPoint.x + grabOffsetX, bounds.minX, bounds.maxX);
      mesh.position.z = clamp(dragPoint.z + grabOffsetZ, bounds.minZ, bounds.maxZ);
    }
  }

  function updateRotation(next: [number, number, number, number]): void {
    const rotation = mesh.rotationQuaternion ?? Quaternion.Identity();
    rotation.set(next[0], next[1], next[2], next[3]);
    mesh.rotationQuaternion = rotation;
  }

  return {
    beginTouchDrag: beginDrag,
    moveTouchDrag: moveDrag,
    rotateDrag(radians) {
      if (heldPointerId === null) return;
      updateRotation(rotateQuaternionY(mesh.rotationQuaternion ?? Quaternion.Identity(), radians));
    },
    flipDrag() {
      if (heldPointerId === null) return;
      updateRotation(flipQuaternion(mesh.rotationQuaternion ?? Quaternion.Identity()));
    },
    finishTouchDrag: (pointerId) => finishDrag(pointerId),
    cancelTouchDrag: (pointerId) => finishDrag(pointerId, true, true),
    setTouchSelected(selected) {
      isTouchSelected = selected;
      if (heldPointerId === null) setHighlight(idleHighlight());
    },
    dispose() {
      finishDrag(undefined, false);
      canvas.style.cursor = "default";
      highlight.dispose();
    },
  };
}
