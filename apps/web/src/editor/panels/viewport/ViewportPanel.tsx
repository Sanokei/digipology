import { useEffect, useMemo } from "react";

import { TableScene } from "../../../scene/TableScene";
import { KernelStore } from "../../../state/kernelStore";
import { useEditorSnapshot, type EditorStore } from "../../state";
import { usePlaytestController } from "../../playtest/context";
import { usePlaytestSnapshot } from "../../playtest/PlaytestController";

export function ViewportPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const draftProjection = useMemo(() => new KernelStore(), []);
  const playtest = usePlaytestController();
  const runtime = usePlaytestSnapshot(playtest);
  useEffect(() => draftProjection.loadRelease(snapshot.bundle), [draftProjection, snapshot.bundle]);
  const playing = runtime.status === "playing";
  return <div className="editor-viewport"><TableScene store={playing ? playtest.projection : draftProjection} client={playing ? playtest : null} interactionsPaused={!playing} readOnly={!playing} /></div>;
}
