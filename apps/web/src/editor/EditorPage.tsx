import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CloudUpload, Pause, Play, Save, Square } from "lucide-react";

import { EditorLayoutHost, type EditorLayoutApi } from "./EditorLayoutHost";
import { EDITOR_PANELS } from "./layout";
import { MenuBar, type MenuAction } from "./menubar/MenuBar";
import { OpenDraftDialog } from "./OpenDraftDialog";
import { NewDraftDialog } from "./NewDraftDialog";
import { CommitTextInput } from "./panels/common/PanelComponents";
import { draftToCreatePrefill } from "./publish";
import {
  EditorStore,
  createEmptyEditorDraft,
  createEditorDraftFromTemplate,
  exportBundleText,
  importBundleAsDraft,
  loadDraftIndex,
  loadEditorDraft,
  saveEditorDraft,
  useEditorSnapshot,
  type EditorTemplateId,
} from "./state";
import "./editor.css";
import { PlaytestController, usePlaytestSnapshot } from "./playtest/PlaytestController";

function downloadBundle(store: EditorStore): void {
  const draft = store.getSnapshot().draft;
  const blob = new Blob([exportBundleText(draft)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${draft.slug || draft.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  store.log("Bundle exported.");
}

function randomDraftId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `draft-${Date.now()}`;
}

export function EditorPage() {
  const params = useParams<{ draftId: string }>();
  const landing = params.draftId === undefined;
  const draftId = params.draftId?.trim() || "untitled";
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const layoutApi = useRef<EditorLayoutApi | null>(null);
  const playtest = useMemo(() => new PlaytestController(), []);
  const playtestSnapshot = usePlaytestSnapshot(playtest);
  const [error, setError] = useState<string | null>(null);
  const [openDrafts, setOpenDrafts] = useState<ReturnType<typeof loadDraftIndex> | null>(null);
  const [newDraftOpen, setNewDraftOpen] = useState(landing);
  const store = useMemo(() => {
    const loaded = landing ? null : loadEditorDraft(localStorage, draftId);
    const draft = loaded ?? createEmptyEditorDraft(draftId);
    const editorStore = new EditorStore(draft, { saveDraft: (next) => saveEditorDraft(localStorage, next) });
    if (loaded === null && !landing) {
      try { saveEditorDraft(localStorage, draft); }
      catch { editorStore.log("This browser could not initialize local draft storage.", "warning"); }
    }
    return editorStore;
  }, [draftId, landing]);
  const snapshot = useEditorSnapshot(store);
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => () => playtest.dispose(), [playtest]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable=true]") === true;
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.shiftKey ? store.redo() : store.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault(); store.duplicateSelectedEntity();
      } else if (event.key === "Delete") {
        event.preventDefault(); store.deleteSelectedEntity();
      } else if (event.key === "F5") {
        event.preventDefault();
        if (event.shiftKey) playtest.stop();
        else if (playtest.getSnapshot().status === "playing") playtest.tick();
        else void playtest.start(store.getSnapshot().draft);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [playtest, store]);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) return;
    try {
      store.replaceDraft(importBundleAsDraft(await file.text(), draftId));
      setError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "That bundle could not be imported.";
      setError(message);
      store.log(`Import rejected: ${message}`, "warning");
    }
  };
  const publish = useCallback(() => navigate("/create", { state: draftToCreatePrefill(store.getSnapshot().draft) }), [navigate, store]);
  const openDraft = useCallback(() => {
    setOpenDrafts([...loadDraftIndex(localStorage)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }, []);
  const chooseDraft = useCallback((id: string) => {
    setOpenDrafts(null);
    navigate(`/edit/${encodeURIComponent(id)}`);
  }, [navigate]);
  const newDraft = useCallback(() => setNewDraftOpen(true), []);
  const chooseTemplate = useCallback((templateId: EditorTemplateId) => {
    const id = randomDraftId();
    if (templateId !== "blank") {
      saveEditorDraft(localStorage, createEditorDraftFromTemplate(templateId, id));
    }
    setNewDraftOpen(false);
    navigate(`/edit/${encodeURIComponent(id)}`);
  }, [navigate]);
  const closeTemplatePicker = useCallback(() => {
    if (landing) navigate("/");
    else setNewDraftOpen(false);
  }, [landing, navigate]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]") === true) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); newDraft(); }
      else if (event.key.toLowerCase() === "o") { event.preventDefault(); openDraft(); }
      else if (event.key.toLowerCase() === "s") { event.preventDefault(); downloadBundle(store); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [newDraft, openDraft, store]);
  const onLayoutReady = useCallback((api: EditorLayoutApi | null) => { layoutApi.current = api; }, []);
  const menuActions = useMemo<Record<"File" | "Edit" | "Play" | "Window", MenuAction[]>>(() => ({
    File: [
      { kind: "action", label: "New draft", shortcut: "Ctrl+N", searchTerms: ["template blank card dice zone"], onSelect: newDraft },
      { kind: "action", label: "Open local draft…", shortcut: "Ctrl+O", onSelect: openDraft },
      { kind: "separator" },
      { kind: "action", label: "Import bundle…", searchTerms: ["json file"], onSelect: () => fileInput.current?.click() },
      { kind: "action", label: "Export bundle", shortcut: "Ctrl+S", searchTerms: ["download json"], onSelect: () => downloadBundle(store) },
      { kind: "separator" },
      { kind: "action", label: "Publish…", searchTerms: ["create upload release"], onSelect: publish },
    ],
    Edit: [
      { kind: "action", label: "Undo", shortcut: "Ctrl+Z", disabled: snapshot.past.length === 0, onSelect: () => store.undo() },
      { kind: "action", label: "Redo", shortcut: "Ctrl+Shift+Z", disabled: snapshot.future.length === 0, onSelect: () => store.redo() },
      { kind: "separator" },
      { kind: "action", label: "Duplicate entity", shortcut: "Ctrl+D", disabled: snapshot.selectedEntityId === null, onSelect: () => { store.duplicateSelectedEntity(); } },
      { kind: "action", label: "Delete entity", shortcut: "Delete", disabled: snapshot.selectedEntityId === null, onSelect: () => { store.deleteSelectedEntity(); } },
    ],
    Play: [
      { kind: "action", label: "Play draft", shortcut: "F5", searchTerms: ["start test run"], disabled: playtestSnapshot.status !== "stopped", onSelect: () => { void playtest.start(store.getSnapshot().draft); } },
      { kind: "action", label: "Advance kernel tick", shortcut: "F5", searchTerms: ["step timer"], disabled: playtestSnapshot.status !== "playing", onSelect: () => playtest.tick() },
      { kind: "action", label: "Stop playtest", shortcut: "Shift+F5", searchTerms: ["discard runtime"], disabled: playtestSnapshot.status === "stopped", onSelect: () => playtest.stop() },
    ],
    Window: [
      { kind: "header", label: "Panels" },
      ...EDITOR_PANELS.map((panel): MenuAction => ({ kind: "action", label: panel.title, onSelect: () => layoutApi.current?.focusPanel(panel.id) })),
      { kind: "separator" },
      { kind: "action", label: "Reset layout", onSelect: () => layoutApi.current?.resetLayout() },
    ],
  }), [newDraft, openDraft, playtest, playtestSnapshot.status, publish, snapshot.future.length, snapshot.past.length, snapshot.selectedEntityId, store]);
  return <div className="editor-shell">
    <MenuBar actions={menuActions} status={<><span className={`editor-save-status is-${snapshot.saveStatus}`}>{snapshot.saveStatus === "saved" ? <Save size={13} /> : null}{snapshot.saveStatus}</span><span>{snapshot.draft.title}</span>{playtestSnapshot.status === "playing" ? <><button type="button" className="editor-transport-button" onClick={() => playtest.tick()}><Pause size={13} />Tick {playtestSnapshot.tick}</button><button type="button" className="editor-transport-button" onClick={() => playtest.stop()}><Square size={12} />Stop</button></> : <button type="button" className="editor-transport-button" disabled={playtestSnapshot.status === "starting"} onClick={() => { void playtest.start(store.getSnapshot().draft); }}><Play size={13} />{playtestSnapshot.status === "starting" ? "Starting" : "Play"}</button>}<button type="button" className="editor-publish-button" onClick={publish}><CloudUpload size={14} />Publish</button></>} />
    <div className="editor-details-bar">
      <label>Title<CommitTextInput value={snapshot.draft.title} onCommit={(title) => store.updateDraftMetadata({ title })} /></label>
      <label>Tagline<CommitTextInput value={snapshot.draft.tagline} onCommit={(tagline) => store.updateDraftMetadata({ tagline })} /></label>
      <label>Players<input type="number" min={1} max={snapshot.draft.maxPlayers} value={snapshot.draft.minPlayers} onChange={(event) => store.updateDraftMetadata({ minPlayers: event.currentTarget.valueAsNumber })} /></label>
      <span>to</span><input aria-label="Maximum players" type="number" min={snapshot.draft.minPlayers} max={64} value={snapshot.draft.maxPlayers} onChange={(event) => store.updateDraftMetadata({ maxPlayers: event.currentTarget.valueAsNumber })} />
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
    <input ref={fileInput} className="editor-hidden-input" type="file" accept="application/json,.json" onChange={(event) => void importFile(event)} />
    {openDrafts === null ? null : <OpenDraftDialog drafts={openDrafts} onOpen={chooseDraft} onClose={() => setOpenDrafts(null)} />}
    {newDraftOpen ? <NewDraftDialog onChoose={chooseTemplate} onClose={closeTemplatePicker} /> : null}
    <EditorLayoutHost store={store} playtest={playtest} onReady={onLayoutReady} />
  </div>;
}
