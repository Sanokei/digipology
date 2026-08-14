import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { luaApiManifest } from "digipology-lua/lua-api-manifest";

import { createLuaEditorExtensions } from "../../scripting/setup";
import { scriptContent, useEditorSnapshot, type EditorStore } from "../../state";

export function LuaEditorPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const selectedPath = snapshot.selectedScriptPath;
  const content = selectedPath === null ? null : scriptContent(snapshot.draft, selectedPath);

  useEffect(() => {
    if (mount.current === null || content === null) return;
    const editor = new EditorView({
      parent: mount.current,
      state: EditorState.create({
        doc: content,
        extensions: createLuaEditorExtensions({
          manifest: luaApiManifest,
          onChange: (source) => store.updateSelectedScript(source),
          onFormatError: (message) => store.log(`Lua format failed: ${message}`, "error"),
        }),
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [selectedPath, store]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || content === null || editor.state.doc.toString() === content) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
  }, [content]);

  return <section className="editor-panel editor-lua-panel" aria-label="Lua IDE">
    <div className="editor-panel-heading"><span>{selectedPath ?? "Lua IDE"}</span><small>Ctrl+S formats with StyLua</small></div>
    {content === null ? <div className="editor-empty-state">Select or create a script to begin.</div> : <div ref={mount} className="editor-lua-mount" />}
  </section>;
}
