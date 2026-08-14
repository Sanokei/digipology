import { useEditorSnapshot, type EditorStore } from "../../state";

export function ConsolePanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  return <section className="editor-panel console-panel" aria-label="Editor diagnostics">
    <div className="editor-panel-heading"><span>Diagnostics</span><small>{snapshot.logs.length}</small></div>
    <ol className="editor-log-list">{[...snapshot.logs].reverse().map((entry) => <li key={entry.id} className={`is-${entry.level}`}><time>{entry.timestamp.slice(11, 19)}</time><span>{entry.message}</span></li>)}</ol>
  </section>;
}
