import { useEffect, type RefObject } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";

import { attachDragBehavior } from "./dragBehavior";
import {
  GRABBABLE_SIZE,
  TABLE_DEPTH,
  TABLE_SURFACE_Y,
  TABLE_WIDTH,
  buildCamera,
  buildLighting,
  buildTable,
} from "./table";

export function useBabylonScene(canvasRef: RefObject<HTMLCanvasElement>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
    });
    const scene = new Scene(engine);
    scene.clearColor = Color4.FromHexString("#08110eff");

    const camera = buildCamera(scene, canvas);
    const { table, grabbable } = buildTable(scene);
    const { shadows } = buildLighting(scene);
    shadows.addShadowCaster(grabbable);
    table.receiveShadows = true;

    const halfPiece = GRABBABLE_SIZE / 2;
    const detachDragBehavior = attachDragBehavior({
      scene,
      camera,
      canvas,
      mesh: grabbable,
      bounds: {
        minX: -TABLE_WIDTH / 2 + halfPiece,
        maxX: TABLE_WIDTH / 2 - halfPiece,
        minZ: -TABLE_DEPTH / 2 + halfPiece,
        maxZ: TABLE_DEPTH / 2 - halfPiece,
        restingY: TABLE_SURFACE_Y + halfPiece,
      },
    });

    // The render loop must remain entirely outside React: never set React state
    // from a frame tick or pointer move. Babylon observables and refs own it.
    const renderScene = () => {
      scene.render();
    };
    engine.runRenderLoop(renderScene);

    const resizeObserver = new ResizeObserver(() => {
      engine.resize();
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      detachDragBehavior();
      camera.detachControl();
      engine.stopRenderLoop(renderScene);
      scene.dispose();
      engine.dispose();
    };
  }, [canvasRef]);
}
