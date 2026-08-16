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

export async function handleTouchPointerInput(
  gestures: TouchGestureMachine,
  adapter: Pick<SceneAdapter, "pick" | "isGrabbable">,
  input: TouchPointerInput,
): Promise<TouchGestureDecision[]> {
  const { pickX, pickY, ...event } = input;
  if (event.type !== "down") return gestures.handle(event);
  const entityId = await adapter.pick(pickX, pickY);
  return gestures.handle({
    ...event,
    target: entityId === null ? null : { entityId, grabbable: adapter.isGrabbable(entityId) },
  });
}

