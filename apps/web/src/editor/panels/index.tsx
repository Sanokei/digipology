import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";

import type { EditorPanelId } from "../layout";
import type { EditorStore } from "../state";
import { PanelSkeleton } from "./common/PanelSkeleton";

const LazyHierarchy = lazy(async () => ({ default: (await import("./hierarchy/HierarchyPanel")).HierarchyPanel }));
const LazyInspector = lazy(async () => ({ default: (await import("./inspector/InspectorPanel")).InspectorPanel }));
const LazyConsole = lazy(async () => ({ default: (await import("./console/ConsolePanel")).ConsolePanel }));
const LazyHistory = lazy(async () => ({ default: (await import("./history/HistoryPanel")).HistoryPanel }));
const LazyViewport = lazy(async () => ({ default: (await import("./viewport/ViewportPanel")).ViewportPanel }));

type PanelComponent = LazyExoticComponent<ComponentType<{ store: EditorStore }>>;

export const PANEL_REGISTRY: Readonly<Record<EditorPanelId, PanelComponent>> = {
  hierarchy: LazyHierarchy,
  inspector: LazyInspector,
  console: LazyConsole,
  history: LazyHistory,
  viewport: LazyViewport,
};

export function renderEditorPanel(panelId: EditorPanelId, store: EditorStore): ReactNode {
  const Panel = PANEL_REGISTRY[panelId];
  return <Suspense fallback={<PanelSkeleton panelId={panelId} />}><Panel store={store} /></Suspense>;
}
