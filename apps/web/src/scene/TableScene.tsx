import { useRef, type ReactNode } from "react";

import { useBabylonScene } from "./useBabylonScene";

interface TableSceneProps {
  topBar?: ReactNode;
  hand?: ReactNode;
}

export function TableScene({ topBar, hand }: TableSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useBabylonScene(canvasRef);

  return (
    <main className="table-scene">
      <canvas
        ref={canvasRef}
        className="table-scene__canvas"
        aria-label="Interactive 3D tabletop with a draggable cube"
        role="img"
        tabIndex={0}
      />
      {topBar === undefined ? null : <div className="table-scene__topbar">{topBar}</div>}
      <div className="table-scene__hint" aria-hidden="true">
        Drag the cube · Orbit, pan &amp; zoom
      </div>
      {hand === undefined ? null : <div className="table-scene__hand">{hand}</div>}
    </main>
  );
}
