import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ReleaseBundleDto } from "digipology-protocol/http";

import { api } from "../../../api/client";
import { useAuth } from "../../../auth/AuthContext";
import { summarizeAiEdit, type AiEditSummary } from "../../ai";
import {
  importBundleAsDraft,
  saveEditorDraft,
  useEditorSnapshot,
  type EditorStore,
} from "../../state";

type PanelState = "idle" | "busy" | "unconfigured" | "capped" | "error";

function draftId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `ai-draft-${Date.now()}`;
}

export function aiPanelStateForError(code: string): PanelState {
  return code === "ai_unconfigured" ? "unconfigured" : code === "ai_daily_cap" ? "capped" : "error";
}

export function AiAssistPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<PanelState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<{ bundle: ReleaseBundleDto; summary: AiEditSummary } | null>(null);

  const signIn = () => navigate("/login", { state: { backgroundLocation: location } });
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (user === null) { signIn(); return; }
    if (prompt.trim() === "") return;
    setState("busy"); setMessage(null);
    const result = await api.createAiGame(prompt.trim());
    if (!result.ok) { setState(aiPanelStateForError(result.error.code)); setMessage(result.error.message); return; }
    try {
      const id = draftId();
      const draft = importBundleAsDraft(JSON.stringify(result.value.draft), id);
      draft.tagline = prompt.trim().slice(0, 240);
      saveEditorDraft(localStorage, draft);
      navigate(`/edit/${encodeURIComponent(id)}`);
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const edit = async (event: FormEvent) => {
    event.preventDefault();
    if (user === null) { signIn(); return; }
    if (instruction.trim() === "") return;
    setState("busy"); setMessage(null); setPending(null);
    const result = snapshot.draft.slug === ""
      ? await api.createAiGame(`${instruction.trim()}\n\nUse this current draft as context:\n${JSON.stringify(snapshot.bundle)}`)
      : await api.editAiGame(snapshot.draft.slug, instruction.trim());
    if (!result.ok) { setState(aiPanelStateForError(result.error.code)); setMessage(result.error.message); return; }
    setPending({ bundle: result.value.draft, summary: summarizeAiEdit(snapshot.bundle, result.value.draft) });
    setState("idle");
  };
  const apply = () => {
    if (pending !== null) store.applyAiBundle(pending.bundle);
    setPending(null);
  };

  return <section className="editor-panel" aria-label="AI assist">
    <div className="editor-panel-heading"><span>AI Assist</span><small>Create or edit</small></div>
    {state === "unconfigured" ? <p className="editor-ai-notice">AI assist isn't set up on this server yet. The manual editor is still fully available.</p> : null}
    {state === "capped" ? <p className="editor-ai-notice">You've reached today's AI assist limit. Keep editing manually or try again tomorrow.</p> : null}
    {state === "error" && message !== null ? <p className="editor-ai-notice" role="alert">{message}</p> : null}
    <form className="editor-ai-form" onSubmit={(event) => void create(event)}>
      <label htmlFor="editor-ai-create">Create a new game from a prompt</label>
      <textarea id="editor-ai-create" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} />
      <button type="submit" disabled={state === "busy"}>{user === null ? "Sign in to create" : "Create new draft"}</button>
    </form>
    <form className="editor-ai-form" onSubmit={(event) => void edit(event)}>
      <label htmlFor="editor-ai-edit">Edit the open draft</label>
      <textarea id="editor-ai-edit" value={instruction} onChange={(event) => setInstruction(event.currentTarget.value)} />
      <button type="submit" disabled={state === "busy"}>{user === null ? "Sign in to edit" : "Preview edit"}</button>
    </form>
    {pending === null ? null : <div className="editor-diff-summary" role="dialog" aria-label="AI edit summary">
      <strong>Review changes before applying</strong>
      <ul>
        <li>Entities: {pending.summary.entityCountDelta >= 0 ? "+" : ""}{pending.summary.entityCountDelta}</li>
        {Object.entries(pending.summary.scriptLineDeltas).map(([path, delta]) => <li key={path}>{path}: {delta >= 0 ? "+" : ""}{delta} lines</li>)}
        <li>Settings: {pending.summary.changedSettingsKeys.length === 0 ? "unchanged" : pending.summary.changedSettingsKeys.join(", ")}</li>
      </ul>
      <div className="editor-diff-actions"><button type="button" onClick={apply}>Apply as one edit</button><button type="button" onClick={() => setPending(null)}>Cancel</button></div>
    </div>}
  </section>;
}
