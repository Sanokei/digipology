import { useEffect, useMemo } from "react";

import { TableScene } from "../../../scene/TableScene";
import { KernelStore } from "../../../state/kernelStore";
import { useEditorSnapshot, type EditorStore } from "../../state";
import { usePlaytestController } from "../../playtest/context";
import { usePlaytestSnapshot } from "../../playtest/PlaytestController";
import { AudioControls } from "../../../components/AudioControls";
import { useTableAudio } from "../../../audio/useTableAudio";

export function ViewportPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const draftProjection = useMemo(() => new KernelStore(), []);
  const playtest = usePlaytestController();
  const runtime = usePlaytestSnapshot(playtest);
  useEffect(() => draftProjection.loadRelease(snapshot.bundle), [draftProjection, snapshot.bundle]);
  const playing = runtime.status === "playing";
  const projection = playing ? playtest.projection : draftProjection;
  const audio = useTableAudio(projection, playing, runtime.playerId);
  return <div className="editor-viewport"><TableScene store={projection} playerId={playing ? runtime.playerId : ""} client={playing ? playtest : null} interactionsPaused={!playing} readOnly={!playing} topBar={<div className="editor-viewport__sound"><AudioControls {...audio} /></div>} /></div>;
}
