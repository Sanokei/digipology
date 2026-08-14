import { useRef, type ReactNode } from "react";

import type { KernelStore } from "../state/kernelStore";
import { useBabylonScene } from "./useBabylonScene";

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
}

export function TableScene({ store, client = null, interactionsPaused, readOnly = false, topBar, panels, overlay }: TableSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useBabylonScene(canvasRef, store, client, interactionsPaused || readOnly);
  return (
    <main className="table-scene">
      <canvas ref={canvasRef} className="table-scene__canvas" aria-label={readOnly ? "Read-only 3D draft preview" : "Live synchronized 3D tabletop"} role="img" tabIndex={0} onContextMenu={(event) => event.preventDefault()} />
      {topBar === undefined ? null : <div className="table-scene__topbar">{topBar}</div>}
      <div className={`table-scene__hint${readOnly ? " table-scene__hint--readonly" : ""}`} aria-hidden="true">{readOnly ? "Draft preview · edit values in Inspector" : "Drag to move · Double-click to flip"}</div>
      {panels}{overlay}
    </main>
  );
}
