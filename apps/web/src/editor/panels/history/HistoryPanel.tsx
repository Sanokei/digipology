import { RotateCcw, RotateCw } from "lucide-react";
import { useEditorSnapshot, type EditorStore } from "../../state";

export function HistoryPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  return <section className="editor-panel history-panel" aria-label="Edit history">
    <div className="editor-panel-heading"><span>Undo history</span><span className="editor-heading-actions"><button type="button" onClick={() => store.undo()} disabled={snapshot.past.length === 0} aria-label="Undo"><RotateCcw size={14} /></button><button type="button" onClick={() => store.redo()} disabled={snapshot.future.length === 0} aria-label="Redo"><RotateCw size={14} /></button></span></div>
    <ol className="editor-history-list">{snapshot.past.map((frame, index) => <li key={`${frame.timestamp}-${index}`}><button type="button" onClick={() => store.jumpToHistory(index)}><span>{frame.label}</span><time>{frame.timestamp.slice(11, 19)}</time></button></li>)}</ol>
    {snapshot.future.length === 0 ? null : <p className="editor-history-future">{snapshot.future.length} redo step{snapshot.future.length === 1 ? "" : "s"} available</p>}
  </section>;
}
