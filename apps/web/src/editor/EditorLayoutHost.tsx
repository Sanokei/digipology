import { useCallback, useEffect, useMemo, useState } from "react";
import { Actions, DockLocation, Layout, Model, TabNode, TabSetNode } from "flexlayout-react";
import "flexlayout-react/style/dark.css";

import {
  EDITOR_LAYOUT_STORAGE_KEY,
  createDefaultEditorLayout,
  createPanelTab,
  isEditorPanelId,
  loadEditorLayout,
  panelDefinition,
  type EditorPanelId,
} from "./layout";
import { renderEditorPanel } from "./panels";
import type { EditorStore } from "./state";

export interface EditorLayoutApi {
  focusPanel(panelId: EditorPanelId): void;
  resetLayout(): void;
}

function initialModel(): Model {
  try { return Model.fromJson(loadEditorLayout(localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY))); }
  catch { return Model.fromJson(createDefaultEditorLayout()); }
}

export function EditorLayoutHost({ store, onReady }: { store: EditorStore; onReady?: (api: EditorLayoutApi | null) => void }) {
  const [model, setModel] = useState(initialModel);
  const focusPanel = useCallback((panelId: EditorPanelId) => {
    const definition = panelDefinition(panelId);
    const existing = model.getNodeById(definition.tabId);
    if (existing instanceof TabNode) {
      model.doAction(Actions.selectTab(existing.getId()));
      return;
    }
    let target = model.getNodeById(definition.defaultTabsetId);
    if (!(target instanceof TabSetNode)) {
      model.visitNodes((node) => { if (!(target instanceof TabSetNode) && node instanceof TabSetNode) target = node; });
    }
    if (target instanceof TabSetNode) {
      model.doAction(Actions.addNode(createPanelTab(panelId), target.getId(), DockLocation.CENTER, -1, true));
    }
  }, [model]);
  const resetLayout = useCallback(() => {
    localStorage.removeItem(EDITOR_LAYOUT_STORAGE_KEY);
    setModel(Model.fromJson(createDefaultEditorLayout()));
  }, []);
  const api = useMemo<EditorLayoutApi>(() => ({ focusPanel, resetLayout }), [focusPanel, resetLayout]);
  useEffect(() => { onReady?.(api); return () => onReady?.(null); }, [api, onReady]);
  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    return typeof component === "string" && isEditorPanelId(component)
      ? renderEditorPanel(component, store)
      : <div className="editor-empty-state">This panel is unavailable.</div>;
  }, [store]);
  return <div className="editor-layout-host"><Layout model={model} factory={factory}
    onModelChange={(next) => { try { localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify(next.toJson())); } catch { /* Layout persistence is best-effort. */ } }} /></div>;
}
