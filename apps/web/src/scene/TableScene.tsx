import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { InspectOverlay, type InspectOverlayItem } from "../components/InspectOverlay";
import { ObjectContextMenu, type ObjectContextMenuAction } from "../components/ObjectContextMenu";
import { TableHints, type TableHintEvent, type TableHintGesture } from "../components/TableHints";
import {
  contextActionsFor,
  entityDisplayLabel,
  heldByDisplayName,
  hoverStatusText,
} from "../pages/tableContextModel";
import { localHandId, localSeatId } from "../pages/tableHandModel";
import type { KernelStore } from "../state/kernelStore";
import { useKernelStore } from "../state/useKernelStore";
import { useBabylonScene, type TableHoverRequest } from "./useBabylonScene";
import type { RendererStatus } from "./rendererPolicy";

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
  onRendererStatus?: (status: RendererStatus) => void;
  rendererStatus?: RendererStatus | null;
  rendererOverrideActive?: boolean;
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
  onRendererStatus,
  rendererStatus = null,
  rendererOverrideActive = false,
}: TableSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useKernelStore(store);
  const [contextMenu, setContextMenu] = useState<{ entityId: string; x: number; y: number } | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<TableHoverRequest | null>(null);
  const [hintEvent, setHintEvent] = useState<TableHintEvent | null>(null);
  const scenePaused = interactionsPaused || readOnly || contextMenu !== null || inspectedId !== null;
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
    onProjectorChange,
    onRendererStatus,
  );

  const state = view.displayedState;
  const contextEntity = contextMenu === null ? undefined : state?.entities[contextMenu.entityId];
  const seatId = localSeatId(state, playerId);
  const contextModels = useMemo(() => contextEntity === undefined || state === null
    ? []
    : contextActionsFor(contextEntity, state, playerId, seatId, client !== null), [client, contextEntity, playerId, seatId, state]);
  const contextActions: ObjectContextMenuAction[] = contextModels.map((model) => ({
    id: model.id,
    label: model.label,
    disabled: model.disabled,
    run: () => {
      if (model.action === null) setInspectedId(contextEntity?.id ?? null);
      else client?.sendAction(model.action);
    },
  }));

  const inspectItem = useMemo<InspectOverlayItem | null>(() => {
    if (inspectedId === null || state === null) return null;
    const entity = state.entities[inspectedId];
    if (entity === undefined) return null;
    const handId = localHandId(state, playerId);
    const owned = handId !== null && state.entities[handId]?.components.container?.items.includes(entity.id) === true;
    const faceUp = entity.components.flippable?.flipped ?? entity.components.card?.faceUp ?? true;
    const hidden = entity.components.card !== undefined && !faceUp && !owned;
    const definitionId = entity.components.card?.definitionId;
    const label = hidden ? "Face-down card" : entityDisplayLabel(entity, view.definitions);
    return {
      entityId: entity.id,
      label,
      color: definitionId === undefined ? "#d7b26d" : view.definitions[definitionId]?.color ?? "#e7dfc8",
      kind: entity.components.card === undefined ? "token" : "card",
      hidden,
      heldBy: heldByDisplayName(entity, playerId, view.players),
    };
  }, [inspectedId, playerId, state, view.definitions, view.players]);

  useEffect(() => {
    if (interactionsPaused || contextActions.length === 0) setContextMenu(null);
  }, [interactionsPaused, contextActions.length]);

  const hoverEntity = hover === null ? undefined : state?.entities[hover.entityId];
  const hoverText = hoverEntity === undefined ? null : hoverStatusText(hoverEntity, playerId, view.players);
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
  </main>;
}
