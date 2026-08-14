import { useRef, type ReactNode } from "react";

import type { RoomClient } from "../net/roomClient";
import type { KernelStore } from "../state/kernelStore";
import { useBabylonScene } from "./useBabylonScene";

interface TableSceneProps {
  store: KernelStore;
  client: RoomClient;
  interactionsPaused: boolean;
  topBar?: ReactNode;
  panels?: ReactNode;
  overlay?: ReactNode;
}

export function TableScene({ store, client, interactionsPaused, topBar, panels, overlay }: TableSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useBabylonScene(canvasRef, store, client, interactionsPaused);
  return (
    <main className="table-scene">
      <canvas ref={canvasRef} className="table-scene__canvas" aria-label="Live synchronized 3D tabletop" role="img" tabIndex={0} onContextMenu={(event) => event.preventDefault()} />
      {topBar === undefined ? null : <div className="table-scene__topbar">{topBar}</div>}
      <div className="table-scene__hint" aria-hidden="true">Drag to move · Double-click to flip</div>
      {panels}{overlay}
    </main>
  );
}
