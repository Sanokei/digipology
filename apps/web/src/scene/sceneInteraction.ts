import type { SceneAdapter } from "./sceneAdapter";
import {
  TouchGestureMachine,
  type NormalizedPointerEvent,
  type TouchGestureDecision,
} from "./touchGestures";

export interface TouchPointerInput extends Omit<NormalizedPointerEvent, "target"> {
  pickX: number;
  pickY: number;
}

export interface HoverPicker {
  request(x: number, y: number): void;
  dispose(): void;
}

/**
 * Coalesces hover requests to one in-flight pick plus the latest queued point.
 * A rejected pick is reported as a null result and does not wedge later picks.
 */
export function createHoverPicker(
  adapter: Pick<SceneAdapter, "pick">,
  onResult: (entityId: string | null) => void,
): HoverPicker {
  let pending: { x: number; y: number } | null = null;
  let inFlight = false;
  let disposed = false;

  function pickNext(): void {
    if (disposed || inFlight || pending === null) return;
    const point = pending;
    pending = null;
    inFlight = true;
    void adapter.pick(point.x, point.y).then(
      (entityId) => {
        if (!disposed) onResult(entityId);
      },
      () => {
        if (!disposed) onResult(null);
      },
    ).finally(() => {
      inFlight = false;
      pickNext();
    });
  }

  return {
    request(x: number, y: number): void {
      if (disposed) return;
      pending = { x, y };
      pickNext();
    },
    dispose(): void {
      disposed = true;
      pending = null;
    },
  };
}

export async function handleTouchPointerInput(
  gestures: TouchGestureMachine,
  adapter: Pick<SceneAdapter, "pick" | "isGrabbable">,
  input: TouchPointerInput,
): Promise<TouchGestureDecision[]> {
  const { pickX, pickY, ...event } = input;
  if (event.type === "cancel" && !gestures.hasActivePointer(event.pointerId)) return [];
  if (event.type !== "down") return gestures.handle(event);
  const entityId = await adapter.pick(pickX, pickY);
  return gestures.handle({
    ...event,
    target: entityId === null ? null : { entityId, grabbable: adapter.isGrabbable(entityId) },
  });
}
