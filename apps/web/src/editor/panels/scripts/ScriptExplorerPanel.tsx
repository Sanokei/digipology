import { FilePlus2, Pencil, Trash2 } from "lucide-react";

import { scriptFiles, useEditorSnapshot, type EditorStore } from "../../state";

export function ScriptExplorerPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const scripts = scriptFiles(snapshot.bundle);
  const create = () => {
    const name = window.prompt("New script name", "rules.lua");
    if (name?.trim()) store.createScript(name);
  };
  const rename = () => {
    if (snapshot.selectedScriptPath === null) return;
    const name = window.prompt("Rename script", snapshot.selectedScriptPath.slice("scripts/".length));
    if (name?.trim()) store.renameSelectedScript(name);
  };
  const remove = () => {
    if (snapshot.selectedScriptPath !== null && window.confirm(`Delete ${snapshot.selectedScriptPath}?`)) {
      store.deleteSelectedScript();
    }
  };
  return <section className="editor-panel" aria-label="Script explorer">
    <div className="editor-panel-heading"><span>Scripts</span><div className="editor-heading-actions">
      <button type="button" aria-label="Create script" title="Create script" onClick={create}><FilePlus2 size={14} /></button>
      <button type="button" aria-label="Rename script" title="Rename script" disabled={snapshot.selectedScriptPath === null} onClick={rename}><Pencil size={13} /></button>
      <button type="button" aria-label="Delete script" title="Delete script" disabled={snapshot.selectedScriptPath === null} onClick={remove}><Trash2 size={13} /></button>
    </div></div>
    {scripts.length === 0 ? <div className="editor-empty-state">No Lua scripts yet. Create one to add game rules.</div> :
      <div className="editor-script-list">{scripts.map((file) => <button
        type="button"
        className={file.path === snapshot.selectedScriptPath ? "is-selected" : ""}
        key={file.path}
        onClick={() => store.selectScript(file.path)}
      ><span>{file.path.slice("scripts/".length)}</span><small>{file.byteLength} B</small></button>)}</div>}
  </section>;
}
