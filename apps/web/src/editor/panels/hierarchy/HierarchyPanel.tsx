import { useCallback, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";

import { useEditorSnapshot, type EditorStore } from "../../state";
import { PanelEmptyState } from "../common/PanelComponents";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenuComponents";
import { Tree } from "../common/Tree";
import { useTreeKeyboard } from "../common/useTreeKeyboard";

export function HierarchyPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const ids = Object.keys(snapshot.entities).sort((left, right) => left.localeCompare(right));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const beginRename = () => {
    if (snapshot.selectedEntityId !== null) setRenamingId(snapshot.selectedEntityId);
  };
  const onKeyDown = useTreeKeyboard({
    ids,
    selectedId: snapshot.selectedEntityId,
    labelFor: (id) => id,
    onSelect: (id) => store.selectEntity(id),
    onRename: beginRename,
    onDelete: () => store.deleteSelectedEntity(),
    onDuplicate: () => store.duplicateSelectedEntity(),
  });
  return <section className="editor-panel hierarchy-panel" aria-label="Entity hierarchy">
    <div className="editor-panel-heading"><span>Entities</span><small>{ids.length}</small></div>
    {ids.length === 0 ? <PanelEmptyState>No entities yet. Import a bundle with an initial layout to begin.</PanelEmptyState> :
      <Tree nodes={ids.map((id) => ({ id, label: id, suffix: <small>{Object.keys(snapshot.entities[id]!.components).length}</small> }))}
        selectedId={snapshot.selectedEntityId} renamingId={renamingId} onKeyDown={onKeyDown}
        onSelect={(id) => store.selectEntity(id)} onRenameRequest={(id) => { store.selectEntity(id); setRenamingId(id); }}
        onRename={(id, value) => { store.selectEntity(id); store.renameSelectedEntity(value); }}
        onRenameEnd={() => setRenamingId(null)}
        onContextMenu={(id, event) => { event.preventDefault(); store.selectEntity(id); setMenu({ id, x: event.clientX, y: event.clientY }); }} />}
    {menu === null ? null : <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
      <ContextMenuItem onSelect={() => { setRenamingId(menu.id); setMenu(null); }}><Pencil size={13} />Rename <kbd>F2</kbd></ContextMenuItem>
      <ContextMenuItem onSelect={() => { store.duplicateSelectedEntity(); setMenu(null); }}><Copy size={13} />Duplicate <kbd>Ctrl+D</kbd></ContextMenuItem>
      <ContextMenuItem danger onSelect={() => { store.deleteSelectedEntity(); setMenu(null); }}><Trash2 size={13} />Delete <kbd>Del</kbd></ContextMenuItem>
    </ContextMenu>}
  </section>;
}
