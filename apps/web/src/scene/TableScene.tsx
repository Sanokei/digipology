import { useEffect, useRef, useState, type ReactNode } from "react";

import { ObjectContextMenu, type ObjectContextMenuAction } from "../components/ObjectContextMenu";
import type { KernelStore } from "../state/kernelStore";
import { useKernelStore } from "../state/useKernelStore";
import { useBabylonScene } from "./useBabylonScene";
import type { RendererStatus } from "./rendererPolicy";

export interface TableActionSender {
  sendAction(action: { type: string; payload: unknown }): unknown;
}

interface TableSceneProps {
  store: KernelStore;
  client?: TableActionSender | null;
  interactionsPaused: boolean;
  readOnly?: boolean;
  topBar?: ReactNode;
  panels?: ReactNode;
  overlay?: ReactNode;
  onRendererStatus?: (status: RendererStatus) => void;
  rendererStatus?: RendererStatus | null;
  rendererOverrideActive?: boolean;
}

export function TableScene({
  store,
  client = null,
  interactionsPaused,
  readOnly = false,
  topBar,
  panels,
  overlay,
  onRendererStatus,
  rendererStatus = null,
  rendererOverrideActive = false,
}: TableSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useKernelStore(store);
  const [contextMenu, setContextMenu] = useState<{ entityId: string; x: number; y: number } | null>(null);
  const scenePaused = interactionsPaused || readOnly || contextMenu !== null;
  useBabylonScene(canvasRef, store, client, scenePaused, setContextMenu, onRendererStatus);
  const contextEntity = contextMenu === null ? undefined : view.displayedState?.entities[contextMenu.entityId];
  const contextActions: ObjectContextMenuAction[] = [];
  if (contextEntity !== undefined && client !== null) {
    if (contextEntity.components.flippable !== undefined || contextEntity.components.card !== undefined) {
      contextActions.push({
        id: "flip",
        label: "Flip",
        run: () => client.sendAction({ type: "entity.flip", payload: { entityId: contextEntity.id } }),
      });
    }
    if (contextEntity.components.die !== undefined) {
      contextActions.push({
        id: "roll",
        label: "Roll",
        run: () => client.sendAction({ type: "die.roll", payload: { entityId: contextEntity.id } }),
      });
    }
  }
  useEffect(() => {
    if (interactionsPaused || contextActions.length === 0) setContextMenu(null);
  }, [interactionsPaused, contextActions.length]);
  return (
    <main className="table-scene">
      <canvas ref={canvasRef} className="table-scene__canvas" aria-label={readOnly ? "Read-only 3D draft preview" : "Live synchronized 3D tabletop"} role="img" tabIndex={0} onContextMenu={(event) => event.preventDefault()} />
      {topBar === undefined ? null : <div className="table-scene__topbar">{topBar}</div>}
      <div className={`table-scene__hint${readOnly ? " table-scene__hint--readonly" : ""}`} aria-hidden="true">{readOnly ? "Draft preview · edit values in Inspector" : <><span className="pointer-hint">Drag to move · Double-click to flip</span><span className="touch-hint">Drag pieces · Two fingers move table · Hold for actions</span>{rendererOverrideActive && rendererStatus !== null && rendererStatus.mounted !== null ? <span>Renderer: {rendererStatus.mounted} (override)</span> : null}</>}</div>
      {panels}{overlay}
      {contextMenu === null || contextActions.length === 0 ? null : <ObjectContextMenu x={contextMenu.x} y={contextMenu.y} actions={contextActions} onDismiss={() => setContextMenu(null)} />}
    </main>
  );
}
