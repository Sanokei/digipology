import { useEffect, useRef, type RefObject } from "react";

import type { TableActionSender } from "./TableScene";
import type { KernelStore } from "../state/kernelStore";
import {
  classifyRendererTier,
  rendererOverrideFromSearch,
  selectRendererAdapter,
  type RendererAdapterKind,
} from "./rendererPolicy";
import { mountSceneAdapter } from "./mountSceneAdapter";
import { handleTouchPointerInput } from "./sceneInteraction";
import type { SceneAdapter, SceneAdapterDependencies } from "./sceneAdapter";
import { TouchGestureMachine, type TouchGestureDecision } from "./touchGestures";

export interface TableContextRequest {
  entityId: string;
  x: number;
  y: number;
}

async function loadAdapter(
  renderer: RendererAdapterKind,
  dependencies: SceneAdapterDependencies,
): Promise<SceneAdapter> {
  if (renderer === "lite") {
    const { createLiteSceneAdapter } = await import("./liteSceneAdapter");
    return createLiteSceneAdapter(dependencies);
  }
  const { createWebglSceneAdapter } = await import("./webglSceneAdapter");
  return createWebglSceneAdapter(dependencies);
}

export function useBabylonScene(
  canvasRef: RefObject<HTMLCanvasElement>,
  store: KernelStore,
  client: TableActionSender | null,
  interactionsPaused: boolean,
  onContextRequest?: (request: TableContextRequest) => void,
): void {
  const pausedRef = useRef(interactionsPaused);
  pausedRef.current = interactionsPaused;
  const contextRequestRef = useRef(onContextRequest);
  contextRequestRef.current = onContextRequest;
  const adapterRef = useRef<SceneAdapter | null>(null);
  const cancelTouchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    adapterRef.current?.setPaused(interactionsPaused);
    if (interactionsPaused) cancelTouchRef.current?.();
  }, [interactionsPaused]);

  useEffect(() => {
    const currentCanvas = canvasRef.current;
    if (currentCanvas === null) return;
    const canvas: HTMLCanvasElement = currentCanvas;
    let effectDisposed = false;
    let cleanupMounted: (() => void) | null = null;
    let pendingAdapter: SceneAdapter | null = null;

    const mount = async (): Promise<void> => {
      const deviceNavigator = navigator as Navigator & {
        deviceMemory?: number;
        userAgentData?: { mobile?: boolean };
      };
      const tier = classifyRendererTier({
        deviceMemory: deviceNavigator.deviceMemory,
        hardwareConcurrency: deviceNavigator.hardwareConcurrency,
        userAgent: deviceNavigator.userAgent,
        mobile: deviceNavigator.userAgentData?.mobile,
      });
      const selection = selectRendererAdapter(
        "gpu" in navigator,
        rendererOverrideFromSearch(window.location.search),
      );
      if (selection.requestedLiteFallback) {
        console.info("Babylon-Lite requires WebGPU; using the WebGL renderer instead.");
      }
      const dependencies: SceneAdapterDependencies = {
        sendAction: client === null ? undefined : (action) => client.sendAction(action),
      };
      const adapter = await mountSceneAdapter(
        selection,
        async (renderer) => {
          const loaded = await loadAdapter(renderer, dependencies);
          pendingAdapter = loaded;
          return loaded;
        },
        canvas,
        tier,
        (error) => {
          console.info("Babylon-Lite could not start; using the WebGL renderer instead.", error);
        },
      );
      if (effectDisposed) {
        adapter.dispose();
        return;
      }
      pendingAdapter = null;
      adapterRef.current = adapter;
      adapter.setPaused(pausedRef.current);
      const sync = () => adapter.syncEntities(store.getSnapshot());
      const unsubscribe = store.subscribe(sync);
      sync();

      const gestures = new TouchGestureMachine();
      const releasedPointerIds = new Set<number>();
      const mousePointers = new Map<number, string>();
      const pressedMousePointers = new Set<number>();
      let gestureTimer: ReturnType<typeof setTimeout> | null = null;
      let touchQueue = Promise.resolve();
      let disposed = false;
      let hoverSequence = 0;

      function applyGestureDecisions(decisions: readonly TouchGestureDecision[]): void {
        const rect = canvas.getBoundingClientRect();
        for (const decision of decisions) {
          if (decision.type === "drag-start") {
            if (!pausedRef.current) {
              adapter.beginDrag(
                decision.entityId,
                decision.pointerId,
                decision.x - rect.left,
                decision.y - rect.top,
              );
            }
          } else if (decision.type === "drag-move") {
            adapter.updateDrag(decision.pointerId, decision.x - rect.left, decision.y - rect.top);
          } else if (decision.type === "drag-end") {
            adapter.updateDrag(decision.pointerId, decision.x - rect.left, decision.y - rect.top);
            releasedPointerIds.add(decision.pointerId);
            adapter.endDrag(decision.pointerId);
          } else if (decision.type === "drag-cancel") {
            releasedPointerIds.add(decision.pointerId);
            adapter.cancelDrag(decision.pointerId);
          } else if (decision.type === "tap") {
            adapter.setHighlight(decision.entityId, "selected");
          } else if (decision.type === "double-tap") {
            if (client !== null && !pausedRef.current && decision.entityId !== null) {
              client.sendAction({ type: "entity.flip", payload: { entityId: decision.entityId } });
            }
          } else if (decision.type === "long-press") {
            if (!pausedRef.current) {
              contextRequestRef.current?.({ entityId: decision.entityId, x: decision.x, y: decision.y });
            }
          } else if (decision.type === "camera-start") {
            adapter.camera.attach();
          } else if (decision.type === "camera-pan") {
            adapter.camera.pan(decision.deltaX, decision.deltaY);
          } else if (decision.type === "camera-pinch") {
            adapter.camera.pinch(decision.previousDistance, decision.distance);
          }
        }
      }

      function scheduleGestureDeadline(timestamp: number): void {
        if (gestureTimer !== null) clearTimeout(gestureTimer);
        gestureTimer = null;
        const deadline = gestures.nextDeadline();
        if (deadline === null) return;
        gestureTimer = setTimeout(() => {
          gestureTimer = null;
          applyGestureDecisions(gestures.advance(deadline));
          scheduleGestureDeadline(deadline);
        }, Math.max(0, deadline - timestamp));
      }

      function abortTouch(): void {
        if (gestureTimer !== null) clearTimeout(gestureTimer);
        gestureTimer = null;
        applyGestureDecisions(gestures.abort());
      }
      cancelTouchRef.current = abortTouch;

      function queueTouch(event: PointerEvent, type: "down" | "move" | "up" | "cancel"): void {
        const rect = canvas.getBoundingClientRect();
        const input = {
          type,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          pickX: event.clientX - rect.left,
          pickY: event.clientY - rect.top,
          timestamp: event.timeStamp,
          pointerType: event.pointerType,
        } as const;
        touchQueue = touchQueue.then(async () => {
          if (disposed || pausedRef.current) {
            abortTouch();
            return;
          }
          const decisions = await handleTouchPointerInput(gestures, adapter, input);
          if (disposed) return;
          applyGestureDecisions(decisions);
          scheduleGestureDeadline(event.timeStamp);
        }).catch((error: unknown) => {
          console.info("Table pointer input was ignored after a renderer pick failed.", error);
          abortTouch();
        });
      }

      const handlePointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          event.preventDefault();
          releasedPointerIds.delete(event.pointerId);
          queueTouch(event, "down");
          return;
        }
        if (pausedRef.current) return;
        const rect = canvas.getBoundingClientRect();
        if (event.button === 2) {
          if (client !== null) {
            void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
              if (!disposed && entityId !== null) {
                client.sendAction({ type: "entity.flip", payload: { entityId } });
              }
            });
          }
          return;
        }
        if (event.button !== 0 || adapter.handlesDesktopDrag) return;
        const pointerId = event.pointerId;
        pressedMousePointers.add(pointerId);
        void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
          if (disposed || !pressedMousePointers.has(pointerId) || entityId === null || !adapter.isGrabbable(entityId)) return;
          mousePointers.set(pointerId, entityId);
          adapter.beginDrag(entityId, pointerId, event.clientX - rect.left, event.clientY - rect.top);
        });
      };
      const handlePointerMove = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          event.preventDefault();
          queueTouch(event, "move");
          return;
        }
        const rect = canvas.getBoundingClientRect();
        if (mousePointers.has(event.pointerId)) {
          adapter.updateDrag(event.pointerId, event.clientX - rect.left, event.clientY - rect.top);
          return;
        }
        if (adapter.handlesDesktopDrag) return;
        const sequence = ++hoverSequence;
        void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
          if (!disposed && sequence === hoverSequence) adapter.setHighlight(entityId, "hover");
        });
      };
      const handlePointerUp = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          event.preventDefault();
          queueTouch(event, "up");
          return;
        }
        pressedMousePointers.delete(event.pointerId);
        if (!mousePointers.delete(event.pointerId)) return;
        const rect = canvas.getBoundingClientRect();
        adapter.updateDrag(event.pointerId, event.clientX - rect.left, event.clientY - rect.top);
        adapter.endDrag(event.pointerId);
      };
      const handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          queueTouch(event, "cancel");
          return;
        }
        pressedMousePointers.delete(event.pointerId);
        if (mousePointers.delete(event.pointerId)) adapter.cancelDrag(event.pointerId);
      };
      const handleLostPointerCapture = (event: PointerEvent): void => {
        if (releasedPointerIds.delete(event.pointerId)) return;
        handlePointerCancel(event);
      };
      const handleDoubleClick = (event: MouseEvent): void => {
        if (client === null || pausedRef.current) return;
        const rect = canvas.getBoundingClientRect();
        void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
          if (!disposed && entityId !== null) {
            client.sendAction({ type: "entity.flip", payload: { entityId } });
          }
        });
      };
      const preventBrowserTouch = (event: TouchEvent) => event.preventDefault();

      canvas.addEventListener("pointerdown", handlePointerDown);
      canvas.addEventListener("pointermove", handlePointerMove);
      canvas.addEventListener("pointerup", handlePointerUp);
      canvas.addEventListener("pointercancel", handlePointerCancel);
      canvas.addEventListener("lostpointercapture", handleLostPointerCapture);
      canvas.addEventListener("dblclick", handleDoubleClick);
      canvas.addEventListener("touchstart", preventBrowserTouch, { passive: false });
      canvas.addEventListener("touchmove", preventBrowserTouch, { passive: false });

      const syncRenderLoop = (): void => {
        const running = document.visibilityState !== "hidden";
        adapter.setRenderLoop(running);
        if (!running) abortTouch();
      };
      document.addEventListener("visibilitychange", syncRenderLoop);
      syncRenderLoop();
      const resize = new ResizeObserver(() => adapter.resize());
      resize.observe(canvas);

      cleanupMounted = () => {
        disposed = true;
        cancelTouchRef.current = null;
        abortTouch();
        unsubscribe();
        resize.disconnect();
        document.removeEventListener("visibilitychange", syncRenderLoop);
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointercancel", handlePointerCancel);
        canvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
        canvas.removeEventListener("dblclick", handleDoubleClick);
        canvas.removeEventListener("touchstart", preventBrowserTouch);
        canvas.removeEventListener("touchmove", preventBrowserTouch);
        adapter.dispose();
        if (adapterRef.current === adapter) adapterRef.current = null;
      };
    };

    void mount().catch((error: unknown) => {
      pendingAdapter?.dispose();
      pendingAdapter = null;
      console.error("Unable to start a table renderer.", error);
    });

    return () => {
      effectDisposed = true;
      cleanupMounted?.();
      cleanupMounted = null;
      pendingAdapter?.dispose();
      pendingAdapter = null;
    };
  }, [canvasRef, client, store]);
}
