import { useEffect, useRef, useState, type RefObject } from "react";

import type { TableActionSender } from "./TableScene";
import type { KernelStore } from "../state/kernelStore";
import {
  classifyRendererTier,
  rendererOverrideFromSearch,
  selectRendererAdapter,
  type RendererAdapterKind,
  type RendererFallback,
  type RendererStatus,
} from "./rendererPolicy";
import { firstSceneFrames } from "./firstSceneFrames";
import { loadSceneAdapter } from "./loadSceneAdapter";
import { mountSceneAdapter } from "./mountSceneAdapter";
import { DesktopControlMachine, type DesktopControlDecision } from "./desktopControls";
import { createHoverPicker, handleTouchPointerInput, pickContextRequest } from "./sceneInteraction";
import type { SceneAdapter, SceneAdapterDependencies } from "./sceneAdapter";
import { TouchGestureMachine, type TouchGestureDecision } from "./touchGestures";
import { localSeatId } from "../pages/tableHandModel";
import { presentationHighlightIds, primaryActionFor } from "../pages/tableContextModel";
import type { TableHintGesture } from "../components/TableHints";

export interface TableContextRequest {
  entityId: string;
  x: number;
  y: number;
}

export interface TableHoverRequest extends TableContextRequest {}
export type TableRenderState = "loading" | "ready" | "failed";


export function useBabylonScene(
  surfaceRef: RefObject<HTMLDivElement>,
  store: KernelStore,
  client: TableActionSender | null,
  interactionsPaused: boolean,
  playerId?: string,
  onContextRequest?: (request: TableContextRequest) => void,
  onInspectRequest?: (entityId: string) => void,
  onHoverRequest?: (request: TableHoverRequest | null) => void,
  onHintGesture?: (gesture: TableHintGesture) => void,
  onProjectorChange?: (projector: ((clientX: number, clientY: number) => { x: number; y: number; z: number } | null) | null) => void,
  onRendererStatus?: (status: RendererStatus) => void,
  canvasLabel = "Live synchronized 3D tabletop",
  rendererAttempt = 0,
): TableRenderState {
  const [renderState, setRenderState] = useState<TableRenderState>("loading");
  const pausedRef = useRef(interactionsPaused);
  pausedRef.current = interactionsPaused;
  const playerRef = useRef(playerId);
  playerRef.current = playerId;
  const changeSeatRef = useRef<(() => void) | null>(null);
  const contextRequestRef = useRef(onContextRequest);
  contextRequestRef.current = onContextRequest;
  const rendererStatusRef = useRef(onRendererStatus);
  rendererStatusRef.current = onRendererStatus;
  const inspectRequestRef = useRef(onInspectRequest);
  inspectRequestRef.current = onInspectRequest;
  const hoverRequestRef = useRef(onHoverRequest);
  hoverRequestRef.current = onHoverRequest;
  const hintGestureRef = useRef(onHintGesture);
  hintGestureRef.current = onHintGesture;
  const projectorChangeRef = useRef(onProjectorChange);
  projectorChangeRef.current = onProjectorChange;
  const adapterRef = useRef<SceneAdapter | null>(null);
  const cancelTouchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    adapterRef.current?.setPaused(interactionsPaused);
    if (interactionsPaused) cancelTouchRef.current?.();
  }, [interactionsPaused]);

  // Selecting another private playtest seat changes ownership, not the GPU
  // lifetime. Cancel the old seat's gestures and refresh its visible indicators.
  useEffect(() => { changeSeatRef.current?.(); }, [playerId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    let canvas!: HTMLCanvasElement;
    const lifetime = new AbortController();
    let effectDisposed = false;
    let cleanupMounted: (() => void) | null = null;
    setRenderState("loading");
    const publishState = (state: TableRenderState) => {
      if (effectDisposed || lifetime.signal.aborted) return;
      canvas.dataset.renderState = state;
      canvas.setAttribute("aria-busy", String(state === "loading"));
      setRenderState(state);
    };
    const nextCanvas = () => {
      if (effectDisposed || lifetime.signal.aborted) throw new Error("This table view has left.");
      canvas = surface.ownerDocument.createElement("canvas");
      canvas.className = "table-scene__canvas";
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", canvasLabel);
      canvas.tabIndex = 0; canvas.oncontextmenu = (event) => event.preventDefault();
      surface.replaceChildren(canvas);
      publishState("loading");
      return canvas;
    };

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
      let fallback: RendererFallback | null = null;
      const publishRendererStatus = (mounted: RendererAdapterKind | null): void => {
        if (effectDisposed || lifetime.signal.aborted) return;
        rendererStatusRef.current?.({
          requested: selection.renderer,
          mounted,
          reason: selection.reason,
          fallback,
          tier,
        });
      };
      publishRendererStatus(null);
      if (selection.requestedLiteFallback) {
        console.info("Babylon-Lite requires WebGPU; using the WebGL renderer instead.");
      }
      const dependencies: SceneAdapterDependencies = {
        sendAction: client === null ? undefined : (action) => client.sendAction(action),
      };
      const adapter = await mountSceneAdapter(
        selection,
        async (renderer) => {
          const adapter = await loadSceneAdapter(renderer, dependencies);
          const initialize = adapter.mount.bind(adapter);
          adapter.mount = async (nextCanvas, options) => {
            await initialize(nextCanvas, options);
            if (options.signal?.aborted) throw new Error("Table renderer initialization was cancelled");
            adapter.syncEntities(store.getSnapshot());
            adapter.setRenderLoop(document.visibilityState !== "hidden");
            await firstSceneFrames(options.signal, requestAnimationFrame, cancelAnimationFrame, () => adapter.presentationReady?.() ?? true);
          };
          return adapter;
        },
        nextCanvas,
        tier,
        (nextFallback, error) => {
          fallback = nextFallback;
          publishRendererStatus(null);
          console.info("Babylon-Lite could not start; using the WebGL renderer instead.", error);
        },
        8_000, lifetime.signal,
      );
      if (effectDisposed) {
        adapter.dispose();
        return;
      }
      adapterRef.current = adapter;
      projectorChangeRef.current?.((clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        if (clientX < rect.left || clientY < rect.top || clientX > rect.right || clientY > rect.bottom) return null;
        return adapter.projectToTable(clientX - rect.left, clientY - rect.top);
      });
      adapter.setPaused(pausedRef.current);
      let heldHighlight = "";
      let lockedHighlight = "";
      const sync = () => {
        const snapshot = store.getSnapshot();
        adapter.syncEntities(snapshot);
        const indicators = presentationHighlightIds(snapshot.displayedState, playerRef.current ?? "");
        const nextHeld = indicators.held;
        const nextLocked = indicators.locked;
        const heldSignature = nextHeld.join("\0");
        const lockedSignature = nextLocked.join("\0");
        if (heldSignature !== heldHighlight) {
          heldHighlight = heldSignature;
          adapter.setHighlight(null, "held");
          for (const id of nextHeld) adapter.setHighlight(id, "held");
        }
        if (lockedSignature !== lockedHighlight) {
          lockedHighlight = lockedSignature;
          adapter.setHighlight(null, "locked");
          for (const id of nextLocked) adapter.setHighlight(id, "locked");
        }
      };
      const unsubscribe = store.subscribe(sync);
      sync();

      const gestures = new TouchGestureMachine();
      const desktop = new DesktopControlMachine();
      const releasedPointerIds = new Set<number>();
      const queuedFlips = new Set<number>();
      let gestureTimer: ReturnType<typeof setTimeout> | null = null;
      let touchQueue = Promise.resolve();
      let disposed = false;
      let seatGeneration = 0;
      let hoverPoint = { x: 0, y: 0 };
      let hoverEntityId: string | null = null;
      const hoverPicker = createHoverPicker(adapter, (entityId) => {
        hoverEntityId = entityId;
        adapter.setHighlight(entityId, "hover");
        if (desktop.activeObject() === null) {
          canvas.style.cursor = entityId !== null && adapter.isGrabbable(entityId) ? "grab" : "default";
        }
        hoverRequestRef.current?.(entityId === null ? null : { entityId, x: hoverPoint.x, y: hoverPoint.y });
      });

      function runPrimary(entityId: string): void {
        const state = store.getSnapshot().displayedState;
        if (state === null) return;
        const entity = state.entities[entityId];
        if (entity === undefined) return;
        const player = playerRef.current ?? "";
        const action = primaryActionFor(entity, state, player, localSeatId(state, player), client !== null);
        if (action === null) return;
        if (action.action === null) inspectRequestRef.current?.(entityId);
        else client?.sendAction(action.action);
      }

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
            hintGestureRef.current?.("drag");
          } else if (decision.type === "drag-cancel") {
            releasedPointerIds.add(decision.pointerId);
            adapter.cancelDrag(decision.pointerId);
          } else if (decision.type === "tap") {
            adapter.setHighlight(decision.entityId, "selected");
          } else if (decision.type === "double-tap") {
            if (client !== null && !pausedRef.current && decision.entityId !== null) {
              runPrimary(decision.entityId);
              hintGestureRef.current?.("primary");
            }
          } else if (decision.type === "long-press") {
            if (!pausedRef.current) {
              contextRequestRef.current?.({ entityId: decision.entityId, x: decision.x, y: decision.y });
              hintGestureRef.current?.("actions");
            }
          } else if (decision.type === "camera-start") {
            adapter.camera.attach();
          } else if (decision.type === "camera-pan") {
            adapter.camera.pan(decision.deltaX, decision.deltaY);
            hintGestureRef.current?.("primary");
          } else if (decision.type === "camera-pinch") {
            adapter.camera.pinch(decision.previousDistance, decision.distance);
            hintGestureRef.current?.("primary");
          }
        }
      }

      function canFlip(entityId: string): boolean {
        const entity = store.getSnapshot().displayedState?.entities[entityId];
        return entity?.components.flippable !== undefined || entity?.components.card !== undefined;
      }

      function applyDesktopDecisions(decisions: readonly DesktopControlDecision[]): void {
        const rect = canvas.getBoundingClientRect();
        for (const decision of decisions) {
          if (decision.type === "object-start") {
            adapter.beginDrag(decision.entityId, decision.pointerId, decision.x - rect.left, decision.y - rect.top);
            canvas.style.cursor = "grabbing";
          } else if (decision.type === "object-move") {
            adapter.updateDrag(decision.pointerId, decision.x - rect.left, decision.y - rect.top);
          } else if (decision.type === "object-drop") {
            adapter.updateDrag(decision.pointerId, decision.x - rect.left, decision.y - rect.top);
            adapter.endDrag(decision.pointerId);
            if (queuedFlips.delete(decision.pointerId)) {
              client?.sendAction({ type: "entity.flip", payload: { entityId: decision.entityId } });
            }
            canvas.style.cursor = hoverEntityId !== null && adapter.isGrabbable(hoverEntityId) ? "grab" : "default";
            hintGestureRef.current?.("drag");
          } else if (decision.type === "object-cancel") {
            queuedFlips.delete(decision.pointerId);
            adapter.cancelDrag(decision.pointerId);
            canvas.style.cursor = hoverEntityId !== null && adapter.isGrabbable(hoverEntityId) ? "grab" : "default";
          } else if (decision.type === "camera-orbit") {
            adapter.camera.orbit(decision.deltaX, decision.deltaY);
            hintGestureRef.current?.("primary");
          } else if (decision.type === "camera-pan") {
            adapter.camera.pan(decision.deltaX, decision.deltaY);
            hintGestureRef.current?.("primary");
          } else {
            const seat = seatGeneration;
            void pickContextRequest(
              adapter,
              decision.x - rect.left,
              decision.y - rect.top,
              decision.x,
              decision.y,
            ).then((request) => {
              if (!disposed && seat === seatGeneration && !pausedRef.current && request !== null) {
                contextRequestRef.current?.(request);
                hintGestureRef.current?.("actions");
              }
            });
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
        const seat = seatGeneration;
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
          if (seat !== seatGeneration) return;
          if (disposed || pausedRef.current) {
            abortTouch();
            return;
          }
          const decisions = await handleTouchPointerInput(gestures, adapter, input);
          if (disposed || seat !== seatGeneration || pausedRef.current) { abortTouch(); return; }
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
        if (event.button < 0 || event.button > 2) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        const rect = canvas.getBoundingClientRect();
        desktop.down({
          pointerId: event.pointerId,
          button: event.button,
          x: event.clientX,
          y: event.clientY,
        });
        canvas.setPointerCapture(event.pointerId);
        if (event.button !== 0) return;
        const pointerId = event.pointerId;
        const seat = seatGeneration;
        void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
          if (disposed || seat !== seatGeneration || pausedRef.current || entityId === null || !adapter.isGrabbable(entityId)) return;
          applyDesktopDecisions(desktop.claimObject(pointerId, entityId));
        });
      };
      const handlePointerMove = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          event.preventDefault();
          queueTouch(event, "move");
          return;
        }
        const decisions = desktop.move(event.pointerId, event.clientX, event.clientY);
        if (decisions.length > 0) {
          event.preventDefault();
          applyDesktopDecisions(decisions);
          return;
        }
        const rect = canvas.getBoundingClientRect();
        if (event.buttons !== 0) return;
        hoverPoint = { x: event.clientX, y: event.clientY };
        hoverPicker.request(event.clientX - rect.left, event.clientY - rect.top);
      };
      const handlePointerUp = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          event.preventDefault();
          queueTouch(event, "up");
          return;
        }
        event.preventDefault();
        applyDesktopDecisions(desktop.up(event.pointerId, event.clientX, event.clientY));
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      const handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          queueTouch(event, "cancel");
          return;
        }
        applyDesktopDecisions(desktop.cancel(event.pointerId));
      };
      const handleLostPointerCapture = (event: PointerEvent): void => {
        if (releasedPointerIds.delete(event.pointerId)) return;
        handlePointerCancel(event);
      };
      const handleDoubleClick = (event: MouseEvent): void => {
        if (client === null || pausedRef.current) return;
        const rect = canvas.getBoundingClientRect();
        const seat = seatGeneration;
        void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
          if (!disposed && seat === seatGeneration && !pausedRef.current && entityId !== null) {
            runPrimary(entityId);
            hintGestureRef.current?.("primary");
          }
        });
      };
      const handleWheel = (event: WheelEvent): void => {
        if (pausedRef.current) return;
        event.preventDefault();
        const active = desktop.activeObject();
        if (active !== null) {
          adapter.rotateDrag(Math.sign(event.deltaY) * Math.PI / 12);
          hintGestureRef.current?.("drag");
        } else {
          adapter.camera.zoom(event.deltaY);
          hintGestureRef.current?.("primary");
        }
      };
      const handleContextMenu = (event: MouseEvent): void => event.preventDefault();
      const handleKeyDown = (event: KeyboardEvent): void => {
        const target = event.target;
        if (target instanceof HTMLElement && (
          target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
        )) return;
        if (event.ctrlKey || event.metaKey || event.altKey || pausedRef.current) return;
        const active = desktop.activeObject();
        if (event.key === "Escape" && active !== null) {
          event.preventDefault();
          applyDesktopDecisions(desktop.cancel(active.pointerId));
        } else if ((event.key === "q" || event.key === "Q") && active !== null) {
          event.preventDefault();
          adapter.rotateDrag(-Math.PI / 12);
        } else if ((event.key === "e" || event.key === "E") && active !== null) {
          event.preventDefault();
          adapter.rotateDrag(Math.PI / 12);
        } else if ((event.key === "f" || event.key === "F") && active !== null && canFlip(active.entityId)) {
          event.preventDefault();
          adapter.flipDrag();
          if (queuedFlips.has(active.pointerId)) queuedFlips.delete(active.pointerId);
          else queuedFlips.add(active.pointerId);
        } else if ((event.key === "f" || event.key === "F") && hoverEntityId !== null && canFlip(hoverEntityId)) {
          event.preventDefault();
          client?.sendAction({ type: "entity.flip", payload: { entityId: hoverEntityId } });
        } else if (event.code === "Space" && active === null) {
          event.preventDefault();
          adapter.camera.reset();
          hintGestureRef.current?.("primary");
        }
      };
      const preventBrowserTouch = (event: TouchEvent) => event.preventDefault();

      canvas.addEventListener("pointerdown", handlePointerDown);
      canvas.addEventListener("pointermove", handlePointerMove);
      canvas.addEventListener("pointerup", handlePointerUp);
      canvas.addEventListener("pointercancel", handlePointerCancel);
      canvas.addEventListener("lostpointercapture", handleLostPointerCapture);
      canvas.addEventListener("dblclick", handleDoubleClick);
      canvas.addEventListener("wheel", handleWheel, { passive: false });
      canvas.addEventListener("contextmenu", handleContextMenu);
      window.addEventListener("keydown", handleKeyDown);
      canvas.addEventListener("touchstart", preventBrowserTouch, { passive: false });
      canvas.addEventListener("touchmove", preventBrowserTouch, { passive: false });

      const syncRenderLoop = (): void => {
        const running = document.visibilityState !== "hidden";
        adapter.setRenderLoop(running);
        if (!running) {
          abortTouch();
          applyDesktopDecisions(desktop.abort());
        }
      };
      document.addEventListener("visibilitychange", syncRenderLoop);
      syncRenderLoop();
      changeSeatRef.current = () => {
        seatGeneration++;
        abortTouch();
        applyDesktopDecisions(desktop.abort());
        hoverPicker.clear();
        hoverEntityId = null;
        adapter.setHighlight(null, "hover");
        adapter.setHighlight(null, "selected");
        hoverRequestRef.current?.(null);
        canvas.style.cursor = "default";
        sync();
      };
      publishRendererStatus(fallback === null ? selection.renderer : "webgl");
      publishState("ready");
      if (rendererAttempt > 0) canvas.focus({ preventScroll: true });
      const resize = new ResizeObserver(() => adapter.resize());
      resize.observe(canvas);

      cleanupMounted = () => {
        disposed = true;
        changeSeatRef.current = null;
        hoverPicker.dispose();
        cancelTouchRef.current = null;
        abortTouch();
        applyDesktopDecisions(desktop.abort());
        unsubscribe();
        projectorChangeRef.current?.(null);
        hoverRequestRef.current?.(null);
        resize.disconnect();
        document.removeEventListener("visibilitychange", syncRenderLoop);
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointercancel", handlePointerCancel);
        canvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
        canvas.removeEventListener("dblclick", handleDoubleClick);
        canvas.removeEventListener("wheel", handleWheel);
        canvas.removeEventListener("contextmenu", handleContextMenu);
        window.removeEventListener("keydown", handleKeyDown);
        canvas.removeEventListener("touchstart", preventBrowserTouch);
        canvas.removeEventListener("touchmove", preventBrowserTouch);
        adapter.dispose();
        if (adapterRef.current === adapter) adapterRef.current = null;
      };
    };

    void mount().catch((error: unknown) => {
      if (effectDisposed || lifetime.signal.aborted) return;
      console.error("Unable to start a table renderer.", error);
      publishState("failed");
    });

    return () => {
      effectDisposed = true;
      lifetime.abort();
      cleanupMounted?.();
      cleanupMounted = null;
      canvas?.remove();
    };
  }, [surfaceRef, client, store, canvasLabel, rendererAttempt]);
  return renderState;
}
