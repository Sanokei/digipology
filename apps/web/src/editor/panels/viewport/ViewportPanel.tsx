import { useEffect, useMemo } from "react";

import { TableScene } from "../../../scene/TableScene";
import { KernelStore } from "../../../state/kernelStore";
import { useEditorSnapshot, type EditorStore } from "../../state";

export function ViewportPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const projection = useMemo(() => new KernelStore(), []);
  useEffect(() => projection.loadRelease(snapshot.bundle), [projection, snapshot.bundle]);
  return <div className="editor-viewport"><TableScene store={projection} interactionsPaused readOnly /></div>;
}
