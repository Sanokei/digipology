import type { IJsonModel, IJsonTabNode } from "flexlayout-react";

export const EDITOR_LAYOUT_STORAGE_KEY = "dgp.editor.layout";

export const EDITOR_PANELS = [
  { id: "hierarchy", title: "Hierarchy", tabId: "panel-hierarchy", defaultTabsetId: "editor-left" },
  { id: "scripts", title: "Scripts", tabId: "panel-scripts", defaultTabsetId: "editor-left" },
  { id: "viewport", title: "Table", tabId: "panel-viewport", defaultTabsetId: "editor-center" },
  { id: "lua", title: "Lua IDE", tabId: "panel-lua", defaultTabsetId: "editor-center" },
  { id: "ai", title: "AI Assist", tabId: "panel-ai", defaultTabsetId: "editor-right" },
  { id: "inspector", title: "Inspector", tabId: "panel-inspector", defaultTabsetId: "editor-right" },
  { id: "console", title: "Console", tabId: "panel-console", defaultTabsetId: "editor-bottom" },
  { id: "history", title: "History", tabId: "panel-history", defaultTabsetId: "editor-bottom" },
] as const;

export type EditorPanelId = typeof EDITOR_PANELS[number]["id"];

const PANEL_IDS = new Set<string>(EDITOR_PANELS.map((panel) => panel.id));

export function isEditorPanelId(value: string): value is EditorPanelId {
  return PANEL_IDS.has(value);
}

export function panelDefinition(id: EditorPanelId) {
  return EDITOR_PANELS.find((panel) => panel.id === id)!;
}

export function createPanelTab(id: EditorPanelId): IJsonTabNode {
  const panel = panelDefinition(id);
  return {
    type: "tab",
    id: panel.tabId,
    name: panel.title,
    component: panel.id,
    config: { panelId: panel.id },
    enableClose: panel.id !== "viewport",
    enableRename: false,
    enableRenderOnDemand: true,
  };
}

export function createDefaultEditorLayout(): IJsonModel {
  return {
    global: {
      splitterSize: 4,
      splitterExtra: 4,
      tabEnableClose: true,
      tabEnableRename: false,
      tabEnablePopout: false,
      tabSetEnableClose: false,
      tabSetEnableDeleteWhenEmpty: true,
      tabSetEnableMaximize: true,
    },
    borders: [],
    layout: {
      type: "row",
      children: [
        { type: "tabset", id: "editor-left", weight: 20, children: [createPanelTab("hierarchy"), createPanelTab("scripts")] },
        {
          type: "column",
          id: "editor-middle",
          weight: 56,
          children: [
            { type: "tabset", id: "editor-center", weight: 72, children: [createPanelTab("viewport"), createPanelTab("lua")] },
            { type: "tabset", id: "editor-bottom", weight: 28, children: [createPanelTab("console"), createPanelTab("history")] },
          ],
        },
        { type: "tabset", id: "editor-right", weight: 24, children: [createPanelTab("inspector"), createPanelTab("ai")] },
      ],
    },
  };
}

function sanitizeNode(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const node = value as Record<string, unknown>;
  if (node.type === "tab") {
    if (typeof node.component !== "string" || !isEditorPanelId(node.component)) return null;
    return { ...node, config: { panelId: node.component } };
  }
  if (node.type !== "row" && node.type !== "column" && node.type !== "tabset") return null;
  const children = Array.isArray(node.children)
    ? node.children.map(sanitizeNode).filter((child): child is Record<string, unknown> => child !== null)
    : [];
  if (children.length === 0) return null;
  return { ...node, children };
}

export function sanitizeStoredLayout(value: unknown): IJsonModel | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const layout = sanitizeNode(object.layout);
  if (layout === null) return null;
  const result: IJsonModel = { borders: [], layout: layout as unknown as IJsonModel["layout"] };
  if (typeof object.global === "object" && object.global !== null && !Array.isArray(object.global)) {
    result.global = object.global as NonNullable<IJsonModel["global"]>;
  }
  return result;
}

export function loadEditorLayout(raw: string | null): IJsonModel {
  if (raw === null) return createDefaultEditorLayout();
  try { return sanitizeStoredLayout(JSON.parse(raw) as unknown) ?? createDefaultEditorLayout(); }
  catch { return createDefaultEditorLayout(); }
}
