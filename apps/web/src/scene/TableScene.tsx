import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderFaceSvg } from "digipology-faces";

import { InspectOverlay, type InspectOverlayItem } from "../components/InspectOverlay";
import { ObjectContextMenu, type ObjectContextMenuAction } from "../components/ObjectContextMenu";
import { DeckSearchPanel } from "../components/DeckSearchPanel";
import { TableHints, type TableHintEvent, type TableHintGesture } from "../components/TableHints";
import {
  contextActionsFor,
  entityDisplayLabel,
  heldByDisplayName,
  hoverTooltipText,
  type TableContextAction,
} from "../pages/tableContextModel";
import { localHandId, localSeatId } from "../pages/tableHandModel";
import type { KernelStore } from "../state/kernelStore";
import { useKernelStore } from "../state/useKernelStore";
import { useBabylonScene, type TableHoverRequest, type TableSnapPreview } from "./useBabylonScene";
import type { RendererStatus } from "./rendererPolicy";
import type { SelectionRectangle } from "../pages/tableSelectionModel";

export interface TableActionSender {
  sendAction(action: { type: string; payload: unknown }): unknown;
}

interface TableSceneProps {
  store: KernelStore;
  client?: TableActionSender | null;
  playerId?: string;
  interactionsPaused: boolean;
  readOnly?: boolean;
  topBar?: ReactNode;
  panels?: ReactNode;
  overlay?: ReactNode;
  onProjectorChange?: (projector: ((clientX: number, clientY: number) => { x: number; y: number; z: number } | null) | null) => void;
  onScreenProjectorChange?: (projector: ((point: { x: number; y: number; z: number }) => { x: number; y: number } | null) | null) => void;
  onTablePointerMove?: (point: { x: number; y: number; z: number }) => void;
  onTablePing?: (point: { x: number; y: number; z: number }) => void;
  onRendererStatus?: (status: RendererStatus) => void;
  rendererStatus?: RendererStatus | null;
  rendererOverrideActive?: boolean;
  graphicsQuality?: "auto" | "high" | "low";
  cameraSensitivity?: number;
  invertCameraY?: boolean;
}

export function TableScene({
  store,
  client = null,
  playerId = "",
  interactionsPaused,
  readOnly = false,
  topBar,
  panels,
  overlay,
  onProjectorChange,
  onScreenProjectorChange,
  onTablePointerMove,
  onTablePing,
  onRendererStatus,
  rendererStatus = null,
  rendererOverrideActive = false,
  graphicsQuality = "auto",
  cameraSensitivity = 1,
  invertCameraY = false,
}: TableSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useKernelStore(store);
  const [contextMenu, setContextMenu] = useState<{ entityId: string; x: number; y: number } | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<TableHoverRequest | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionRectangle | null>(null);
  const [touchSelectionMode, setTouchSelectionMode] = useState(false);
  const [searchDeckId, setSearchDeckId] = useState<string | null>(null);
  const [altPeek, setAltPeek] = useState(false);
  const [snapPreview, setSnapPreview] = useState<TableSnapPreview | null>(null);
  const [hintEvent, setHintEvent] = useState<TableHintEvent | null>(null);
  const projectorRef = useRef<((clientX: number, clientY: number) => { x: number; y: number; z: number } | null) | null>(null);
  const scenePaused = interactionsPaused || readOnly || contextMenu !== null || inspectedId !== null || searchDeckId !== null;
  const signalHint = (gesture: TableHintGesture) => setHintEvent((previous) => ({ gesture, nonce: (previous?.nonce ?? 0) + 1 }));

  useBabylonScene(
    canvasRef,
    store,
    client,
    scenePaused,
    playerId,
    setContextMenu,
    setInspectedId,
    setHover,
    signalHint,
    (projector) => {
      projectorRef.current = projector;
      onProjectorChange?.(projector);
    },
    onScreenProjectorChange,
    onTablePointerMove,
    onTablePing,
    onRendererStatus,
    graphicsQuality,
    cameraSensitivity,
    invertCameraY,
    setSelectedIds,
    setSelectionBox,
    touchSelectionMode,
    setSnapPreview,
  );

  const state = view.displayedState;
  const contextEntity = contextMenu === null ? undefined : state?.entities[contextMenu.entityId];
  const seatId = localSeatId(state, playerId);
  const contextModels = useMemo(() => contextEntity === undefined || state === null
    ? []
    : contextActionsFor(contextEntity, state, playerId, seatId, client !== null, selectedIds), [client, contextEntity, playerId, seatId, selectedIds, state]);
  const toMenuAction = (model: TableContextAction): ObjectContextMenuAction => ({
    id: model.id, label: model.label, disabled: model.disabled,
    ...(model.icon === undefined ? {} : { icon: model.icon }),
    ...(model.shortcut === undefined ? {} : { shortcut: model.shortcut }),
    ...(model.children === undefined ? {} : { children: model.children.map(toMenuAction) }),
    run: () => {
      if (model.intent === "search") setSearchDeckId(contextEntity?.id ?? null);
      else if (model.action === null) setInspectedId(contextEntity?.id ?? null);
      else client?.sendAction(model.action);
    },
  });
  const contextActions: ObjectContextMenuAction[] = contextModels.map(toMenuAction);
  if (contextMenu !== null && onTablePing !== undefined) {
    contextActions.push({
      id: "ping-here",
      label: "Ping here",
      run: () => {
        const point = projectorRef.current?.(contextMenu.x, contextMenu.y) ?? null;
        if (point !== null) onTablePing(point);
      },
    });
  }

  const inspectItem = useMemo<InspectOverlayItem | null>(() => {
    if (inspectedId === null || state === null) return null;
    const entity = state.entities[inspectedId];
    if (entity === undefined) return null;
    const handId = localHandId(state, playerId);
    const owned = handId !== null && state.entities[handId]?.components.container?.items.includes(entity.id) === true;
    const faceUp = entity.components.flippable?.flipped ?? entity.components.card?.faceUp ?? true;
    const hidden = entity.components.card !== undefined && !faceUp && !owned;
    const definitionId = entity.components.appearance?.definitionId ?? entity.components.card?.definitionId ?? entity.components.die?.definitionId;
    const label = hidden ? "Face-down card" : entityDisplayLabel(entity, view.definitions);
    return {
      entityId: entity.id,
      label,
      color: definitionId === undefined ? "#d7b26d" : hidden
        ? view.definitions[definitionId]?.backColor ?? "#8d3429"
        : view.definitions[definitionId]?.color ?? "#e7dfc8",
      kind: entity.components.card === undefined ? "token" : "card",
      hidden,
      heldBy: heldByDisplayName(entity, playerId, view.players),
    };
  }, [inspectedId, playerId, state, view.definitions, view.players]);

  useEffect(() => {
    if (interactionsPaused || contextActions.length === 0) setContextMenu(null);
  }, [interactionsPaused, contextActions.length]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.key === "Alt") setAltPeek(true); };
    const up = (event: KeyboardEvent) => { if (event.key === "Alt") setAltPeek(false); };
    const blur = () => setAltPeek(false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  const hoverEntity = hover === null ? undefined : state?.entities[hover.entityId];
  const hoverText = hoverEntity === undefined ? null : hoverTooltipText(hoverEntity, view.definitions, playerId, view.players);
  const handId = localHandId(state, playerId);
  const hoverOwned = hoverEntity !== undefined && handId !== null && state?.entities[handId]?.components.container?.items.includes(hoverEntity.id) === true;
  const hoverFaceUp = hoverEntity?.components.flippable?.flipped ?? hoverEntity?.components.card?.faceUp ?? true;
  const showPeek = altPeek && hoverEntity?.components.card !== undefined && (hoverOwned || hoverFaceUp);
  const hoverDefinitionId = hoverEntity?.components.appearance?.definitionId ?? hoverEntity?.components.card?.definitionId;
  const hoverFace = hoverDefinitionId === undefined ? undefined : view.definitions[hoverDefinitionId]?.face;
  const hoverFaceUrl = showPeek && hoverFace !== undefined
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderFaceSvg(hoverFace, 600, 840))}`
    : null;
  const contextLabel = contextEntity === undefined ? "Table object" : (() => {
    const handId = localHandId(state, playerId);
    const owned = handId !== null && state?.entities[handId]?.components.container?.items.includes(contextEntity.id) === true;
    const faceUp = contextEntity.components.flippable?.flipped ?? contextEntity.components.card?.faceUp ?? true;
    return contextEntity.components.card !== undefined && !faceUp && !owned
      ? "Face-down card"
      : entityDisplayLabel(contextEntity, view.definitions);
  })();

  return <main className="table-scene">
    <canvas ref={canvasRef} className="table-scene__canvas" aria-label={readOnly ? "Read-only 3D draft preview" : "Live synchronized 3D tabletop"} role="img" tabIndex={0} onContextMenu={(event) => event.preventDefault()} />
    {topBar === undefined ? null : <div className="table-scene__topbar">{topBar}</div>}
    {readOnly
      ? <div className="table-scene__hint table-scene__hint--readonly" aria-hidden="true">Draft preview · edit values in Inspector</div>
      : <TableHints event={hintEvent} />}
    {rendererOverrideActive && rendererStatus?.mounted != null ? <span className="renderer-override-chip">Renderer: {rendererStatus.mounted} (override)</span> : null}
    {hover !== null && hoverText !== null ? <div className="table-object-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="status">{hoverText}</div> : null}
    {showPeek && hover !== null && hoverEntity !== undefined ? <div className="table-card-peek" style={{ left: hover.x + 24, top: hover.y + 24 }}>
      {hoverFaceUrl === null ? null : <img src={hoverFaceUrl} alt="" />}
      <strong>{entityDisplayLabel(hoverEntity, view.definitions)}</strong>
    </div> : null}
    {selectionBox === null ? null : <div className="table-selection-box" style={{ left: Math.min(selectionBox.start.x, selectionBox.end.x), top: Math.min(selectionBox.start.y, selectionBox.end.y), width: Math.abs(selectionBox.end.x - selectionBox.start.x), height: Math.abs(selectionBox.end.y - selectionBox.start.y) }} />}
    {snapPreview === null ? null : <div className="table-snap-ghost" style={{ left: snapPreview.x, top: snapPreview.y }} aria-hidden="true"><span>Snap</span></div>}
    {!touchSelectionMode ? null : <div className="table-selection-count" role="status">Selecting · {selectedIds.length}</div>}
    <button type="button" className="table-selection-toggle" aria-pressed={touchSelectionMode} onClick={() => setTouchSelectionMode((value) => !value)}>Select</button>
    {panels}{overlay}
    {contextMenu === null || contextEntity === undefined || contextActions.length === 0 ? null : <ObjectContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      label={contextLabel}
      heldBy={heldByDisplayName(contextEntity, playerId, view.players)}
      actions={contextActions}
      onDismiss={() => setContextMenu(null)}
    />}
    {inspectItem === null ? null : <InspectOverlay item={inspectItem} onDismiss={() => setInspectedId(null)} />}
    {searchDeckId === null || state === null ? null : <DeckSearchPanel deckId={searchDeckId} state={state} definitions={view.definitions} onTake={(cardId) => client?.sendAction({ type: "deck.search_take", payload: { deckId: searchDeckId, cardId } })} onDismiss={() => setSearchDeckId(null)} />}
  </main>;
}
