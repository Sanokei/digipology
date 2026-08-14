import type { Vector3Like } from "./dragBehavior";

interface TransformParts {
  rotation?: { x: number; y: number; z: number; w: number };
  scale?: Vector3Like;
}

interface DragAction {
  type: string;
  payload: unknown;
}

export function createDragActionCallbacks(
  entityId: string,
  send: (action: DragAction) => unknown,
  currentTransform: () => TransformParts | undefined,
  canInteract: () => boolean,
) {
  return {
    onGrab() {
      if (canInteract()) send({ type: "entity.grab", payload: { entityId } });
    },
    onDrop(position: Vector3Like) {
      if (!canInteract()) return;
      const transform = currentTransform();
      send({
        type: "entity.drop",
        payload: {
          entityId,
          transform: {
            position,
            rotation: transform?.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
            scale: transform?.scale ?? { x: 1, y: 1, z: 1 },
          },
        },
      });
    },
  };
}
