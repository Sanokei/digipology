import { useEditorSnapshot, type EditorStore } from "../../state";
import { usePlaytestController } from "../../playtest/context";
import { usePlaytestSnapshot } from "../../playtest/PlaytestController";

export function ConsolePanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const playtest = usePlaytestController();
  const runtime = usePlaytestSnapshot(playtest);
  return <section className="editor-panel console-panel" aria-label="Editor diagnostics">
    <div className="editor-panel-heading"><span>Diagnostics</span><small>{snapshot.logs.length + runtime.logs.length}</small></div>
    <ol className="editor-log-list">{[...runtime.logs].reverse().map((entry) => <li key={`runtime-${entry.id}`} className={`is-${entry.level}`}><time>PLAY</time><span>{entry.message}</span></li>)}{[...snapshot.logs].reverse().map((entry) => <li key={entry.id} className={`is-${entry.level}`}><time>{entry.timestamp.slice(11, 19)}</time><span>{entry.message}</span></li>)}</ol>
  </section>;
}
