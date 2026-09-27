import { useEffect, useRef, type RefObject } from "react";

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
import { mountSceneAdapter } from "./mountSceneAdapter";
import { DesktopControlMachine, type DesktopControlDecision } from "./desktopControls";
import { createHoverPicker, handleTouchPointerInput, pickContextRequest } from "./sceneInteraction";
import type { SceneAdapter, SceneAdapterDependencies } from "./sceneAdapter";
import { TouchGestureMachine, type TouchGestureDecision } from "./touchGestures";
import { localSeatId } from "../pages/tableHandModel";
import { keyboardCommandFor, presentationHighlightIds, primaryActionFor } from "../pages/tableContextModel";
import { boxSelectionIds, nearestCompatibleSnap, reconcileSelection, toggleSelection, type SelectionRectangle } from "../pages/tableSelectionModel";
import type { TableHintGesture } from "../components/TableHints";

export interface TableContextRequest {
  entityId: string;
  x: number;
  y: number;
}

export interface TableHoverRequest extends TableContextRequest {}
export interface TableSnapPreview { entityId: string; snapPointId: string; x: number; y: number }

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
  playerId?: string,
  onContextRequest?: (request: TableContextRequest) => void,
  onInspectRequest?: (entityId: string) => void,
  onHoverRequest?: (request: TableHoverRequest | null) => void,
  onHintGesture?: (gesture: TableHintGesture) => void,
  onProjectorChange?: (projector: ((clientX: number, clientY: number) => { x: number; y: number; z: number } | null) | null) => void,
  onScreenProjectorChange?: (projector: ((point: { x: number; y: number; z: number }) => { x: number; y: number } | null) | null) => void,
  onTablePointerMove?: (point: { x: number; y: number; z: number }) => void,
  onTablePing?: (point: { x: number; y: number; z: number }) => void,
  onRendererStatus?: (status: RendererStatus) => void,
  onSelectionChange?: (ids: readonly string[]) => void,
  onSelectionBoxChange?: (rectangle: SelectionRectangle | null) => void,
  touchSelectionMode = false,
  onSnapPreviewChange?: (preview: TableSnapPreview | null) => void,
): void {
  const pausedRef = useRef(interactionsPaused);
  pausedRef.current = interactionsPaused;
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
  const screenProjectorChangeRef = useRef(onScreenProjectorChange);
  screenProjectorChangeRef.current = onScreenProjectorChange;
  const tablePointerMoveRef = useRef(onTablePointerMove);
  tablePointerMoveRef.current = onTablePointerMove;
  const tablePingRef = useRef(onTablePing);
  tablePingRef.current = onTablePing;
  const adapterRef = useRef<SceneAdapter | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  selectionChangeRef.current = onSelectionChange;
  const selectionBoxChangeRef = useRef(onSelectionBoxChange);
  selectionBoxChangeRef.current = onSelectionBoxChange;
  const touchSelectionModeRef = useRef(touchSelectionMode);
  touchSelectionModeRef.current = touchSelectionMode;
  const snapPreviewChangeRef = useRef(onSnapPreviewChange);
  snapPreviewChangeRef.current = onSnapPreviewChange;
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
      let fallback: RendererFallback | null = null;
      const publishRendererStatus = (mounted: RendererAdapterKind | null): void => {
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
      let selectedIds: string[] = [];
      let copiedEntityIds: string[] = [];
      let groupDrag: { entityId: string; origin: { x: number; y: number; z: number } } | null = null;
      let deckTakeDrag: { pointerId: number; deckId: string } | null = null;
      const dependencies: SceneAdapterDependencies = {
        sendAction: client === null ? undefined : (action) => {
          if (groupDrag !== null && action.type === "entity.grab" &&
            (action.payload as { entityId?: unknown }).entityId === groupDrag.entityId) return;
          if (groupDrag !== null && action.type === "entity.drop") {
            const payload = action.payload as { entityId?: unknown; transform?: { position?: { x: number; y: number; z: number } } };
            if (payload.entityId === groupDrag.entityId && payload.transform?.position !== undefined) {
              const origin = groupDrag.origin;
              const position = payload.transform.position;
              const ids = [...selectedIds];
              groupDrag = null;
              return client.sendAction({ type: "group.move", payload: {
                entityIds: ids,
                delta: { x: position.x - origin.x, y: position.y - origin.y, z: position.z - origin.z },
              } });
            }
          }
          return client.sendAction(action);
        },
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
        (nextFallback, error) => {
          fallback = nextFallback;
          publishRendererStatus(null);
          console.info("Babylon-Lite could not start; using the WebGL renderer instead.", error);
        },
      );
      if (effectDisposed) {
        adapter.dispose();
        return;
      }
      pendingAdapter = null;
      adapterRef.current = adapter;
      projectorChangeRef.current?.((clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        if (clientX < rect.left || clientY < rect.top || clientX > rect.right || clientY > rect.bottom) return null;
        return adapter.projectToTable(clientX - rect.left, clientY - rect.top);
      });
      screenProjectorChangeRef.current?.((point) => adapter.projectFromTable(point));
      publishRendererStatus(fallback === null ? selection.renderer : "webgl");
      adapter.setPaused(pausedRef.current);
      const publishSelection = (next: readonly string[]): void => {
        selectedIds = [...next].sort();
        adapter.setHighlight(null, "selected");
        for (const id of selectedIds) adapter.setHighlight(id, "selected");
        selectionChangeRef.current?.(selectedIds);
      };
      let heldHighlight = "";
      let lockedHighlight = "";
      const sync = () => {
        const snapshot = store.getSnapshot();
        adapter.syncEntities(snapshot);
        const reconciled = reconcileSelection(selectedIds, snapshot.displayedState);
        if (reconciled.join("\0") !== selectedIds.join("\0")) publishSelection(reconciled);
        const indicators = presentationHighlightIds(snapshot.displayedState, playerId ?? "");
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
        const action = primaryActionFor(entity, state, playerId ?? "", localSeatId(state, playerId ?? ""), client !== null);
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
            if (decision.entityId === null) publishSelection([]);
            else publishSelection(touchSelectionModeRef.current ? toggleSelection(selectedIds, decision.entityId) : [decision.entityId]);
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
          if (decision.type === "object-select") {
            publishSelection(decision.toggle ? toggleSelection(selectedIds, decision.entityId) : [decision.entityId]);
          } else if (decision.type === "box-start") {
            selectionBoxChangeRef.current?.({ start: { x: decision.x, y: decision.y }, end: { x: decision.x, y: decision.y } });
          } else if (decision.type === "box-move") {
            selectionBoxChangeRef.current?.({ start: { x: decision.startX, y: decision.startY }, end: { x: decision.x, y: decision.y } });
          } else if (decision.type === "box-end") {
            selectionBoxChangeRef.current?.(null);
            const state = store.getSnapshot().displayedState;
            if (state !== null) {
              const boxed = boxSelectionIds(state, { start: { x: decision.startX, y: decision.startY }, end: { x: decision.x, y: decision.y } }, (point) => {
                const projected = adapter.projectFromTable(point);
                return projected === null ? null : { x: projected.x + rect.left, y: projected.y + rect.top };
              });
              publishSelection(decision.toggle ? [...new Set([...selectedIds, ...boxed])].sort() : boxed);
            }
          } else if (decision.type === "object-start") {
            const entity = store.getSnapshot().displayedState?.entities[decision.entityId];
            if (entity?.components.deck?.enabled === true && !decision.wholeDeck) {
              deckTakeDrag = { pointerId: decision.pointerId, deckId: decision.entityId };
              canvas.style.cursor = "grabbing";
              continue;
            }
            const origin = entity?.components.transform?.position;
            groupDrag = selectedIds.length > 1 && selectedIds.includes(decision.entityId) && origin !== undefined
              ? { entityId: decision.entityId, origin: { ...origin } } : null;
            adapter.beginDrag(decision.entityId, decision.pointerId, decision.x - rect.left, decision.y - rect.top);
            canvas.style.cursor = "grabbing";
          } else if (decision.type === "object-move") {
            if (deckTakeDrag?.pointerId === decision.pointerId) continue;
            adapter.updateDrag(decision.pointerId, decision.x - rect.left, decision.y - rect.top);
          } else if (decision.type === "object-drop") {
            if (deckTakeDrag?.pointerId === decision.pointerId) {
              const deckId = deckTakeDrag.deckId;
              deckTakeDrag = null;
              const deckTransform = store.getSnapshot().displayedState?.entities[deckId]?.components.transform;
              const point = adapter.projectToTable(decision.x - rect.left, decision.y - rect.top);
              if (deckTransform !== undefined && point !== null) {
                client?.sendAction({ type: "deck.take_top", payload: {
                  deckId,
                  transform: { ...deckTransform, position: { x: point.x, y: deckTransform.position.y, z: point.z } },
                } });
              }
              canvas.style.cursor = hoverEntityId !== null && adapter.isGrabbable(hoverEntityId) ? "grab" : "default";
              hintGestureRef.current?.("drag");
              continue;
            }
            adapter.updateDrag(decision.pointerId, decision.x - rect.left, decision.y - rect.top);
            adapter.endDrag(decision.pointerId);
            if (queuedFlips.delete(decision.pointerId)) {
              client?.sendAction({ type: "entity.flip", payload: { entityId: decision.entityId } });
            }
            canvas.style.cursor = hoverEntityId !== null && adapter.isGrabbable(hoverEntityId) ? "grab" : "default";
            hintGestureRef.current?.("drag");
          } else if (decision.type === "object-cancel") {
            if (deckTakeDrag?.pointerId === decision.pointerId) deckTakeDrag = null;
            groupDrag = null;
            queuedFlips.delete(decision.pointerId);
            adapter.cancelDrag(decision.pointerId);
            canvas.style.cursor = hoverEntityId !== null && adapter.isGrabbable(hoverEntityId) ? "grab" : "default";
          } else if (decision.type === "camera-orbit") {
            adapter.camera.orbit(decision.deltaX, decision.deltaY);
            hintGestureRef.current?.("primary");
          } else if (decision.type === "camera-pan") {
            adapter.camera.pan(decision.deltaX, decision.deltaY);
            hintGestureRef.current?.("primary");
          } else if (decision.type === "context") {
            void pickContextRequest(
              adapter,
              decision.x - rect.left,
              decision.y - rect.top,
              decision.x,
              decision.y,
            ).then((request) => {
              if (!disposed && request !== null) {
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
        if (event.button < 0 || event.button > 2) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        const rect = canvas.getBoundingClientRect();
        if (event.button === 0 && event.altKey) {
          const point = adapter.projectToTable(event.clientX - rect.left, event.clientY - rect.top);
          if (point !== null) tablePingRef.current?.(point);
          return;
        }
        desktop.down({
          pointerId: event.pointerId,
          button: event.button,
          x: event.clientX,
          y: event.clientY,
          toggleSelection: event.ctrlKey || event.metaKey,
          wholeDeck: event.shiftKey,
        });
        canvas.setPointerCapture(event.pointerId);
        if (event.button !== 0) return;
        const pointerId = event.pointerId;
        void adapter.pick(event.clientX - rect.left, event.clientY - rect.top).then((entityId) => {
          if (disposed || pausedRef.current) return;
          if (entityId === null) {
            applyDesktopDecisions(desktop.claimEmpty(pointerId));
          } else if (adapter.isGrabbable(entityId)) {
            applyDesktopDecisions(desktop.claimObject(pointerId, entityId));
          } else {
            publishSelection(event.ctrlKey || event.metaKey ? toggleSelection(selectedIds, entityId) : [entityId]);
          }
        });
      };
      const handlePointerMove = (event: PointerEvent): void => {
        const rect = canvas.getBoundingClientRect();
        const tablePoint = adapter.projectToTable(event.clientX - rect.left, event.clientY - rect.top);
        if (tablePoint !== null) tablePointerMoveRef.current?.(tablePoint);
        if (event.pointerType === "touch") {
          event.preventDefault();
          queueTouch(event, "move");
          return;
        }
        const decisions = desktop.move(event.pointerId, event.clientX, event.clientY);
        const active = desktop.activeObject();
        if (active !== null && tablePoint !== null) {
          const state = store.getSnapshot().displayedState;
          const snapPointId = state === null ? null : nearestCompatibleSnap(state, active.entityId, tablePoint);
          const target = snapPointId === null ? null : state?.entities[snapPointId]?.components.transform?.position;
          const projected = target === null || target === undefined ? null : adapter.projectFromTable(target);
          snapPreviewChangeRef.current?.(projected === null || snapPointId === null ? null : {
            entityId: active.entityId, snapPointId, x: projected.x + rect.left, y: projected.y + rect.top,
          });
        } else {
          snapPreviewChangeRef.current?.(null);
        }
        if (decisions.length > 0) {
          event.preventDefault();
          applyDesktopDecisions(decisions);
          return;
        }
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
        snapPreviewChangeRef.current?.(null);
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      const handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          queueTouch(event, "cancel");
          return;
        }
        applyDesktopDecisions(desktop.cancel(event.pointerId));
        snapPreviewChangeRef.current?.(null);
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
        if (event.altKey || pausedRef.current) return;
        const active = desktop.activeObject();
        const state = store.getSnapshot().displayedState;
        const hoverEntity = hoverEntityId === null ? undefined : state?.entities[hoverEntityId];
        const command = keyboardCommandFor({
          key: event.key, ctrlOrMeta: event.ctrlKey || event.metaKey,
          ...(hoverEntity === undefined ? {} : { entity: hoverEntity }), state, selectedIds,
        });
        if (command?.kind === "copy") {
          if (state?.settings.sandbox === true || state?.settings.allowSpawn === true) {
            copiedEntityIds = selectedIds.length > 0 ? [...selectedIds] : hoverEntityId === null ? [] : [hoverEntityId];
            event.preventDefault();
          }
          return;
        }
        if (command?.kind === "paste") {
          if (state?.settings.sandbox === true || state?.settings.allowSpawn === true) {
            for (const entityId of copiedEntityIds) client?.sendAction({ type: "entity.clone", payload: { entityId } });
            event.preventDefault();
          }
          return;
        }
        if (command?.kind === "action") {
          event.preventDefault();
          client?.sendAction(command.action);
          return;
        }
        if (command?.kind === "clear-selection") {
          event.preventDefault();
          publishSelection([]);
          if (active !== null) applyDesktopDecisions(desktop.cancel(active.pointerId));
          return;
        }
        if (event.ctrlKey || event.metaKey) return;
        if (event.key === "Escape" && active !== null) {
          event.preventDefault();
          applyDesktopDecisions(desktop.cancel(active.pointerId));
        } else if ((event.key === "q" || event.key === "Q") && active !== null) {
          event.preventDefault();
          adapter.rotateDrag(-Math.PI / 12);
        } else if ((event.key === "e" || event.key === "E") && active !== null) {
          event.preventDefault();
          adapter.rotateDrag(Math.PI / 12);
        } else if ((event.key === "q" || event.key === "Q") && hoverEntityId !== null) {
          event.preventDefault();
          client?.sendAction(selectedIds.length > 1 && selectedIds.includes(hoverEntityId)
            ? { type: "group.rotate", payload: { entityIds: selectedIds, steps: -1 } }
            : { type: "entity.rotate", payload: { entityId: hoverEntityId, steps: -1 } });
        } else if ((event.key === "e" || event.key === "E") && hoverEntityId !== null) {
          event.preventDefault();
          client?.sendAction(selectedIds.length > 1 && selectedIds.includes(hoverEntityId)
            ? { type: "group.rotate", payload: { entityIds: selectedIds, steps: 1 } }
            : { type: "entity.rotate", payload: { entityId: hoverEntityId, steps: 1 } });
        } else if ((event.key === "f" || event.key === "F") && active !== null && canFlip(active.entityId)) {
          event.preventDefault();
          adapter.flipDrag();
          if (queuedFlips.has(active.pointerId)) queuedFlips.delete(active.pointerId);
          else queuedFlips.add(active.pointerId);
        } else if ((event.key === "f" || event.key === "F") && hoverEntityId !== null && canFlip(hoverEntityId)) {
          event.preventDefault();
          client?.sendAction(selectedIds.length > 1 && selectedIds.includes(hoverEntityId)
            ? { type: "group.flip", payload: { entityIds: selectedIds } }
            : { type: "entity.flip", payload: { entityId: hoverEntityId } });
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
      const resize = new ResizeObserver(() => adapter.resize());
      resize.observe(canvas);

      cleanupMounted = () => {
        disposed = true;
        hoverPicker.dispose();
        cancelTouchRef.current = null;
        abortTouch();
        applyDesktopDecisions(desktop.abort());
        unsubscribe();
        projectorChangeRef.current?.(null);
        screenProjectorChangeRef.current?.(null);
        hoverRequestRef.current?.(null);
        selectionBoxChangeRef.current?.(null);
        selectionChangeRef.current?.([]);
        snapPreviewChangeRef.current?.(null);
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
  }, [canvasRef, client, playerId, store]);
}
