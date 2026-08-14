import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Ray } from "@babylonjs/core/Culling/ray";
import {
  PointerEventTypes,
  type PointerInfo,
} from "@babylonjs/core/Events/pointerEvents";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface MutableVector3Like extends Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface RayLike {
  origin: Vector3Like;
  direction: Vector3Like;
}

/**
 * Intersects a ray with a horizontal plane without allocating an output value.
 * Returns false for parallel rays and intersections behind the ray origin.
 */
export function intersectRayWithHorizontalPlaneToRef(
  ray: RayLike,
  planeY: number,
  result: MutableVector3Like,
): boolean {
  const denominator = ray.direction.y;
  if (Math.abs(denominator) < 1e-8) {
    return false;
  }

  const distance = (planeY - ray.origin.y) / denominator;
  if (distance < 0 || !Number.isFinite(distance)) {
    return false;
  }

  result.x = ray.origin.x + ray.direction.x * distance;
  result.y = planeY;
  result.z = ray.origin.z + ray.direction.z * distance;
  return (
    Number.isFinite(result.x) &&
    Number.isFinite(result.y) &&
    Number.isFinite(result.z)
  );
}

interface DragBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  restingY: number;
}

interface AttachDragBehaviorOptions {
  scene: Scene;
  camera: ArcRotateCamera;
  canvas: HTMLCanvasElement;
  mesh: Mesh;
  bounds: DragBounds;
  onGrab?: () => void;
  onDrop?: (position: Vector3Like) => void;
  canInteract?: () => boolean;
}

const HOVER_COLOR = Color3.FromHexString("#f7d89b");
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
}: AttachDragBehaviorOptions): () => void {
  const highlight = new HighlightLayer("grab-highlight", scene);
  const pickingRay = new Ray(Vector3.Zero(), Vector3.Down());
  const dragPoint = Vector3.Zero();
  const identityMatrix = Matrix.Identity();
  const dragPlaneY = bounds.restingY + LIFT_HEIGHT;
  let heldPointerId: number | null = null;
  let isHovered = false;

  function setHighlight(color: Color3 | null) {
    highlight.removeMesh(mesh);
    if (color !== null) {
      highlight.addMesh(mesh, color);
    }
  }

  function setHovered(hovered: boolean) {
    if (isHovered === hovered || heldPointerId !== null) {
      return;
    }
    isHovered = hovered;
    canvas.style.cursor = hovered ? "grab" : "default";
    setHighlight(hovered ? HOVER_COLOR : null);
  }

  function finishDrag(pointerId?: number, submit = true) {
    if (heldPointerId === null || (pointerId !== undefined && pointerId !== heldPointerId)) {
      return;
    }

    const capturedPointerId = heldPointerId;
    heldPointerId = null;
    mesh.position.x = clamp(mesh.position.x, bounds.minX, bounds.maxX);
    mesh.position.z = clamp(mesh.position.z, bounds.minZ, bounds.maxZ);
    mesh.position.y = bounds.restingY;
    canvas.style.cursor = isHovered ? "grab" : "default";
    setHighlight(isHovered ? HOVER_COLOR : null);
    camera.attachControl(canvas, true);

    if (submit) onDrop?.({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z });

    if (canvas.hasPointerCapture(capturedPointerId)) {
      canvas.releasePointerCapture(capturedPointerId);
    }
  }

  function handlePointer(pointerInfo: PointerInfo) {
    const event = pointerInfo.event as PointerEvent;

    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      if (event.button !== 0 || pointerInfo.pickInfo?.pickedMesh !== mesh || canInteract?.() === false) {
        return;
      }

      event.preventDefault();
      heldPointerId = event.pointerId;
      isHovered = true;
      mesh.position.y = dragPlaneY;
      camera.detachControl();
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      setHighlight(HELD_COLOR);
      onGrab?.();
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERUP) {
      finishDrag(event.pointerId);
      return;
    }

    if (pointerInfo.type !== PointerEventTypes.POINTERMOVE) {
      return;
    }

    if (heldPointerId === null) {
      setHovered(pointerInfo.pickInfo?.pickedMesh === mesh);
      return;
    }

    if (event.pointerId !== heldPointerId) {
      return;
    }

    scene.createPickingRayToRef(
      scene.pointerX,
      scene.pointerY,
      identityMatrix,
      pickingRay,
      camera,
    );

    if (intersectRayWithHorizontalPlaneToRef(pickingRay, dragPlaneY, dragPoint)) {
      mesh.position.x = clamp(dragPoint.x, bounds.minX, bounds.maxX);
      mesh.position.z = clamp(dragPoint.z, bounds.minZ, bounds.maxZ);
    }
  }

  function handleLostPointerCapture(event: PointerEvent) {
    finishDrag(event.pointerId);
  }

  function handlePointerCancel(event: PointerEvent) {
    finishDrag(event.pointerId);
  }

  const pointerObserver = scene.onPointerObservable.add(handlePointer);
  canvas.addEventListener("lostpointercapture", handleLostPointerCapture);
  canvas.addEventListener("pointercancel", handlePointerCancel);

  return () => {
    finishDrag(undefined, false);
    scene.onPointerObservable.remove(pointerObserver);
    canvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
    canvas.removeEventListener("pointercancel", handlePointerCancel);
    canvas.style.cursor = "default";
    highlight.dispose();
  };
}
