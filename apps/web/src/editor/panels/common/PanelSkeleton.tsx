import type { EditorPanelId } from "../../layout";

export function PanelSkeleton({ panelId }: { panelId: EditorPanelId }) {
  return <div className="editor-panel-skeleton" aria-label={`Loading ${panelId}`}>
    <span /><span /><span /><span /><span />
  </div>;
}
