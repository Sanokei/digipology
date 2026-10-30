import { createPortal } from "react-dom";
import { CardDesignStatus } from "../components/CardDesignStatus";
import { readCardDesigns, designedCard, entityCardBack } from "./cardDesigns";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { InspectOverlay, type InspectOverlayItem } from "../components/InspectOverlay";
import { playingCardIdentity } from "../components/playingCardIdentity";
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
import { cardBackForGame } from "./cardBack";
import { CardBackStatus } from "../components/CardBackStatus";

export interface TableActionSender {
  sendAction(action: { type: string; payload: unknown }): unknown;
}

interface TableSceneProps {
  className?: string;
  artworkStatusTarget?: HTMLElement | null;
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
  className,
  artworkStatusTarget,
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const view = useKernelStore(store);
  const cardDesigns = useMemo(() => readCardDesigns(view.cardDesignsBundle), [view.cardDesignsBundle]);
  const cardBack = useMemo(() => cardBackForGame(view.gameTitle, view.cardBackBundle, view.state?.releaseId), [view.gameTitle, view.cardBackBundle, view.state?.releaseId]);
  const [contextMenu, setContextMenu] = useState<{ entityId: string; x: number; y: number } | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<TableHoverRequest | null>(null);
  const [hintEvent, setHintEvent] = useState<TableHintEvent | null>(null);
  useEffect(() => { setContextMenu(null); setInspectedId(null); setHover(null); }, [playerId]);
  useEffect(() => {
    if (className?.split(" ").includes("draft-play-scene")) return;
    const root = surfaceRef.current?.parentElement;
    const top = root?.querySelector<HTMLElement>(".table-scene__topbar");
    const dock = root?.querySelector<HTMLElement>(".table-bottom-dock");
    if (!root || !top || !dock) return;
    const progress = root.querySelector<HTMLElement>(".game-progress");
    const actions = root.querySelector<HTMLElement>(".table-action-controls");
    const update = () => {
      const bounds = root.getBoundingClientRect();
      const topEdge = Math.max(top.getBoundingClientRect().bottom, progress?.getBoundingClientRect().bottom ?? 0);
      root.style.setProperty("--public-surface-top", `${Math.ceil(topEdge - bounds.top + 8)}px`);
      root.style.setProperty("--public-surface-bottom", `${Math.ceil(bounds.bottom - dock.getBoundingClientRect().top + 8)}px`);
      root.style.setProperty("--table-actions-height", `${Math.ceil(actions?.getBoundingClientRect().height ?? 0)}px`);
    };
    const observer = new ResizeObserver(update);
    for (const element of [root, top, dock, progress, actions]) if (element) observer.observe(element);
    update();
    return () => { observer.disconnect(); for (const property of ["--public-surface-top", "--public-surface-bottom", "--table-actions-height"]) root.style.removeProperty(property); };
  }, [className, view.state !== null]);
  const scenePaused = interactionsPaused || readOnly || contextMenu !== null || inspectedId !== null;
  const signalHint = (gesture: TableHintGesture) => setHintEvent((previous) => ({ gesture, nonce: (previous?.nonce ?? 0) + 1 }));

  const renderState = useBabylonScene(
    surfaceRef,
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
    readOnly ? "Read-only 3D draft preview" : "Live synchronized 3D tabletop",
    rendererAttempt,
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
    const design = hidden ? undefined : designedCard(readCardDesigns(view.cardDesignsBundle), definitionId);
    const label = hidden ? "Face-down card" : design?.card.title ?? entityDisplayLabel(entity, view.definitions);
    const face = hidden ? null : playingCardIdentity(definitionId, label);
    return {
      entityId: entity.id,
      ...(design ? { design } : {}),
      label,
      ...(face === null ? {} : { face }),
      color: definitionId === undefined ? "#d7b26d" : view.definitions[definitionId]?.color ?? "#e7dfc8",
      kind: entity.components.deck !== undefined ? "deck" : entity.components.card === undefined ? "token" : "card",
      hidden,
      heldBy: heldByDisplayName(entity, playerId, view.players),
    };
  }, [inspectedId, playerId, state, view.definitions, view.players, view.cardDesignsBundle]);

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
      : designedCard(cardDesigns, contextEntity.components.card?.definitionId)?.card.title ?? entityDisplayLabel(contextEntity, view.definitions);
  })();

  const artworkStatus = cardDesigns?.families.length ? <CardDesignStatus designs={cardDesigns} /> : Object.values(state?.entities ?? {}).some((entity) => entity.components.card || entity.components.deck) ? <CardBackStatus definition={cardBack} /> : null;
  return <main className={`table-scene${className ? ` ${className}` : ""}`}>
    <div ref={surfaceRef} className="table-scene__surface" />
    {renderState === "ready" ? null : <div className="table-render-status" role={renderState === "failed" ? "alert" : "status"}>
      {renderState === "loading" ? <><span className="loading-spinner" /><p>Preparing your table…</p></>
        : <><p>The table view could not load.</p><button type="button" onClick={() => setRendererAttempt((attempt) => attempt + 1)}>Reload table view</button><p>You can retry without starting a new room.</p></>}
    </div>}
    {topBar === undefined ? null : <div className="table-scene__topbar">{topBar}</div>}
    {readOnly
      ? <div className="table-scene__hint table-scene__hint--readonly" aria-hidden="true">Draft preview · edit values in Inspector</div>
      : <TableHints event={hintEvent} />}
    {rendererOverrideActive && rendererStatus?.mounted != null ? <span className="renderer-override-chip">Renderer: {rendererStatus.mounted} (override)</span> : null}
    {hover !== null && hoverText !== null ? <div className="table-object-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="status">{hoverText}</div> : null}
    {panels}{overlay}
    {artworkStatusTarget ? createPortal(artworkStatus, artworkStatusTarget) : artworkStatus}
    {contextMenu === null || contextEntity === undefined || contextActions.length === 0 ? null : <ObjectContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      label={contextLabel}
      heldBy={heldByDisplayName(contextEntity, playerId, view.players)}
      actions={contextActions}
      onDismiss={() => setContextMenu(null)}
    />}
    {inspectItem === null ? null : <InspectOverlay item={inspectItem} cardBack={state?.entities[inspectItem.entityId] ? entityCardBack(readCardDesigns(view.cardDesignsBundle), state.entities[inspectItem.entityId]!, state.entities, cardBack) : cardBack} onDismiss={() => setInspectedId(null)} />}
  </main>;
}
