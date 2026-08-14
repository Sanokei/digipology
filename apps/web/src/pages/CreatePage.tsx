import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { OwnedGameDto, UploadValidationReportItem } from "digipology-protocol/http";

import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SiteHeader } from "../components/SiteHeader";
import { prevalidateCreateGame, prevalidateRelease } from "../releaseValidation";
import { saveRoomSession } from "../utils/roomSession";
import { readEditorCreatePrefill } from "./createPrefill";
import {
  aiCreatePrefill,
  aiReleasePrefill,
  aiSubmitIntent,
  initialAiCreatorState,
  nextVisibility,
  ownedGameRoomSession,
  reduceAiCreator,
  type AiCreatorEvent,
  type AiCreatorState,
} from "./creatorModel";

export function ValidationReport({ report }: { report: UploadValidationReportItem[] }) {
  return <ul className="validation-report" aria-label="Upload validation report">
    {report.map((item) => <li className={item.ok ? "validation-ok" : "validation-failed"} key={item.check}>
      <strong>{item.ok ? "Pass" : "Fail"}</strong> {item.check.replaceAll("_", " ")}
      {item.detail === undefined ? null : <small>{item.detail}</small>}
    </li>)}
  </ul>;
}

export function CreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const editorPrefill = readEditorCreatePrefill(location.state);
  const [title, setTitle] = useState(() => editorPrefill?.title ?? "");
  const [tagline, setTagline] = useState(() => editorPrefill?.tagline ?? "");
  const [slug, setSlug] = useState(() => editorPrefill?.slug ?? "");
  const [minPlayers, setMinPlayers] = useState(() => editorPrefill?.minPlayers ?? 2);
  const [maxPlayers, setMaxPlayers] = useState(() => editorPrefill?.maxPlayers ?? 4);
  const [bundleText, setBundleText] = useState(() => editorPrefill?.bundleText ?? "");
  const [report, setReport] = useState<UploadValidationReportItem[]>([]);
  const [games, setGames] = useState<OwnedGameDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiState, dispatchAi] = useReducer(reduceAiCreator, initialAiCreatorState);
  const [editInstructions, setEditInstructions] = useState<Record<string, string>>({});
  const [editStates, setEditStates] = useState<Record<string, AiCreatorState>>({});
  const [releaseDrafts, setReleaseDrafts] = useState<Record<string, string>>({});

  const loadGames = useCallback(async () => {
    if (user === null) return;
    const result = await api.listMyGames();
    if (result.ok) setGames(result.value.games);
    else setMessage(result.error.message);
  }, [user]);
  useEffect(() => { void loadGames(); }, [loadGames]);

  function signIn() {
    navigate("/login", { state: { backgroundLocation: location } });
  }

  function validate() {
    const result = prevalidateCreateGame({ title, tagline, slug, minPlayers, maxPlayers }, bundleText);
    setReport(result.report);
    return result;
  }

  async function generateWithAi(event: FormEvent) {
    event.preventDefault();
    const intent = aiSubmitIntent(user, aiPrompt);
    if (intent === "sign_in") { signIn(); return; }
    if (intent === "ignore") return;
    dispatchAi({ type: "requested" });
    const result = await api.createAiGame(aiPrompt.trim());
    if (!result.ok) {
      dispatchAi({
        type: "failed",
        code: result.error.code,
        message: result.error.message,
        ...(result.error.report === undefined ? {} : { report: result.error.report }),
      });
      return;
    }
    dispatchAi({ type: "succeeded", response: result.value });
    const prefill = aiCreatePrefill(result.value, aiPrompt);
    setTitle(prefill.title);
    setTagline(prefill.tagline);
    setSlug("");
    setMinPlayers(prefill.minPlayers);
    setMaxPlayers(prefill.maxPlayers);
    setBundleText(prefill.bundleText);
    setReport(result.value.validationReport);
    setMessage("AI draft loaded below. Review every field, then publish through the normal upload flow.");
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (user === null) { signIn(); return; }
    const checked = validate();
    if (checked.request === null) { setMessage("Fix the failed checks before publishing."); return; }
    setBusy(true); setMessage(null);
    const result = await api.createGame(checked.request);
    setBusy(false);
    if (!result.ok) {
      if (result.error.report !== undefined) setReport(result.error.report);
      setMessage(result.error.message);
      return;
    }
    setMessage(`${result.value.game.title} release 1 is published.`);
    setTitle(""); setTagline(""); setSlug(""); setBundleText(""); setReport([]);
    dispatchAi({ type: "reset" });
    await loadGames();
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    if (user === null) { event.currentTarget.value = ""; signIn(); return; }
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    setBundleText(await file.text());
    setReport([]);
  }

  async function toggle(game: OwnedGameDto) {
    if (user === null) { signIn(); return; }
    const visibility = nextVisibility(game);
    const result = await api.updateGameVisibility(game.slug, visibility);
    if (!result.ok) { setMessage(result.error.message); return; }
    setGames((current) => current.map((candidate) => candidate.slug === game.slug ? result.value.game : candidate));
  }

  async function host(game: OwnedGameDto) {
    if (user === null) { signIn(); return; }
    const result = await api.createRoom({ releaseSlugOrId: game.latestReleaseId, visibility: "private" });
    if (!result.ok) { setMessage(result.error.message); return; }
    saveRoomSession(ownedGameRoomSession(game, result.value));
    navigate(`/table/${encodeURIComponent(result.value.roomId)}`);
  }

  async function publishRelease(game: OwnedGameDto, event: ChangeEvent<HTMLInputElement>) {
    if (user === null) { event.currentTarget.value = ""; signIn(); return; }
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    await publishReleaseText(game, await file.text());
  }

  async function publishReleaseText(game: OwnedGameDto, text: string) {
    if (user === null) { signIn(); return; }
    const checked = prevalidateRelease(text, game.minPlayers, game.maxPlayers);
    setReport(checked.report);
    if (checked.bundle === null) { setMessage("The release failed client-side validation."); return; }
    const result = await api.createRelease(game.slug, checked.bundle);
    if (!result.ok) {
      if (result.error.report !== undefined) setReport(result.error.report);
      setMessage(result.error.message);
      return;
    }
    setMessage(`${game.title} release ${result.value.release.releaseNumber} is published.`);
    setReleaseDrafts((current) => {
      const next = { ...current };
      delete next[game.slug];
      return next;
    });
    await loadGames();
  }

  function updateEditState(slugValue: string, event: AiCreatorEvent) {
    setEditStates((current) => ({
      ...current,
      [slugValue]: reduceAiCreator(current[slugValue] ?? initialAiCreatorState, event),
    }));
  }

  async function editWithAi(game: OwnedGameDto, event: FormEvent) {
    event.preventDefault();
    const instruction = editInstructions[game.slug] ?? "";
    const intent = aiSubmitIntent(user, instruction);
    if (intent === "sign_in") { signIn(); return; }
    if (intent === "ignore") return;
    updateEditState(game.slug, { type: "requested" });
    const result = await api.editAiGame(game.slug, instruction.trim());
    if (!result.ok) {
      updateEditState(game.slug, {
        type: "failed",
        code: result.error.code,
        message: result.error.message,
        ...(result.error.report === undefined ? {} : { report: result.error.report }),
      });
      return;
    }
    updateEditState(game.slug, { type: "succeeded", response: result.value });
    setReleaseDrafts((current) => ({ ...current, [game.slug]: aiReleasePrefill(result.value.draft) }));
    setReport(result.value.validationReport);
  }

  return <div className="site-page"><SiteHeader /><main className="creator-page">
    <section className="creator-panel ai-creator-panel" aria-labelledby="ai-create-title">
      <p className="eyebrow">AI draft studio</p><h2 id="ai-create-title">Describe your game</h2>
      <p>Turn an idea into a reviewable release draft. AI never publishes; the draft still uses the normal upload checks and publish button.</p>
      <form className="stack-form" onSubmit={(event) => void generateWithAi(event)}>
        <label htmlFor="ai-game-prompt">Game description</label>
        <textarea id="ai-game-prompt" rows={6} maxLength={8000} required value={aiPrompt}
          placeholder="A cooperative two-player dice game about repairing a moon base…"
          onChange={(event) => { setAiPrompt(event.currentTarget.value); if (aiState.phase !== "busy") dispatchAi({ type: "reset" }); }} />
        <button className="primary-button" type="submit" disabled={aiState.phase === "busy"}>
          {aiState.phase === "busy" ? "Creating and validating…" : aiState.phase === "failed" ? "Retry AI draft" : "Create draft with AI"}
        </button>
      </form>
      {aiState.message === null ? null : <p className={`form-notice ai-state-${aiState.phase}`} role="status">{aiState.message}</p>}
      {aiState.report.length === 0 ? null : <ValidationReport report={aiState.report} />}
    </section>

    <section className="creator-panel">
      <p className="eyebrow">Creator upload</p><h1>Publish a game</h1>
      <p>Choose a release JSON file or paste the same JSON below. Validation runs locally before upload.</p>
      <form className="stack-form" onSubmit={(event) => void publish(event)}>
        <label htmlFor="game-title">Title</label><input id="game-title" maxLength={80} required value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        <label htmlFor="game-tagline">Tagline</label><input id="game-tagline" maxLength={240} value={tagline} onChange={(event) => setTagline(event.currentTarget.value)} />
        <label htmlFor="game-slug">Slug <small>(optional)</small></label><input id="game-slug" maxLength={48} placeholder="generated-from-title" value={slug} onChange={(event) => setSlug(event.currentTarget.value)} />
        <div className="field-pair"><label>Minimum players<input type="number" min={1} max={64} value={minPlayers} onChange={(event) => setMinPlayers(event.currentTarget.valueAsNumber)} /></label><label>Maximum players<input type="number" min={1} max={64} value={maxPlayers} onChange={(event) => setMaxPlayers(event.currentTarget.valueAsNumber)} /></label></div>
        <label htmlFor="bundle-file">Release JSON file</label><input id="bundle-file" type="file" accept="application/json,.json" onClick={(event) => { if (user === null) { event.preventDefault(); signIn(); } }} onChange={(event) => void readFile(event)} />
        <label htmlFor="bundle-json">Release JSON</label><textarea id="bundle-json" rows={12} value={bundleText} onChange={(event) => { setBundleText(event.currentTarget.value); setReport([]); }} />
        <div className="button-row"><button type="button" className="secondary-button" onClick={validate}>Validate</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Publishing…" : "Publish release 1"}</button></div>
      </form>
      {message === null ? null : <p className="form-notice" role="status">{message}</p>}
      {report.length === 0 ? null : <ValidationReport report={report} />}
    </section>

    <section className="creator-panel" id="my-games" aria-labelledby="my-games-title">
      <p className="eyebrow">Library</p><h2 id="my-games-title">My games</h2>
      {user === null ? <><p>Sign in to keep published games with your account and manage their visibility.</p><button className="secondary-button" type="button" onClick={signIn}>Sign in for My Games</button></> : games.length === 0 ? <p>No uploads yet.</p> : games.map((game) => {
        const editState = editStates[game.slug] ?? initialAiCreatorState;
        const releaseDraft = releaseDrafts[game.slug];
        return <article className="my-game" key={game.slug}>
          <div><h3>{game.title}</h3><p>{game.tagline}</p><small>{game.visibility} · latest release {game.releases[0]?.releaseNumber}</small></div>
          <div className="button-row"><button className="secondary-button" type="button" onClick={() => void toggle(game)}>{game.visibility === "public" ? "Make unlisted" : "Make public"}</button><button className="primary-button" type="button" onClick={() => void host(game)}>Host</button><label className="file-button">New release<input type="file" accept="application/json,.json" onChange={(event) => void publishRelease(game, event)} /></label></div>
          <form className="stack-form ai-edit-form" onSubmit={(event) => void editWithAi(game, event)}>
            <label htmlFor={`ai-edit-${game.slug}`}>Edit with AI</label>
            <textarea id={`ai-edit-${game.slug}`} rows={3} maxLength={8000} required
              placeholder="Add a six-sided die and reset the score at 20…"
              value={editInstructions[game.slug] ?? ""}
              onChange={(event) => setEditInstructions((current) => ({ ...current, [game.slug]: event.currentTarget.value }))} />
            <button className="secondary-button" type="submit" disabled={editState.phase === "busy"}>
              {editState.phase === "busy" ? "Editing and validating…" : editState.phase === "failed" ? "Retry AI edit" : "Create edited draft"}
            </button>
          </form>
          {editState.message === null ? null : <p className={`form-notice ai-state-${editState.phase}`} role="status">{editState.message}</p>}
          {editState.report.length === 0 ? null : <ValidationReport report={editState.report} />}
          {releaseDraft === undefined ? null : <div className="stack-form release-draft-review">
            <label htmlFor={`release-draft-${game.slug}`}>Review new release JSON</label>
            <textarea id={`release-draft-${game.slug}`} rows={10} value={releaseDraft}
              onChange={(event) => setReleaseDrafts((current) => ({ ...current, [game.slug]: event.currentTarget.value }))} />
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={() => {
                const checked = prevalidateRelease(releaseDraft, game.minPlayers, game.maxPlayers);
                setReport(checked.report);
              }}>Validate draft</button>
              <button className="primary-button" type="button" onClick={() => void publishReleaseText(game, releaseDraft)}>Publish reviewed release</button>
            </div>
          </div>}
          <ol className="release-list">{game.releases.map((release) => <li key={release.releaseId}><strong>Release {release.releaseNumber}</strong><span>{new Date(release.createdAt).toLocaleDateString()}</span><code>{release.releaseId}</code></li>)}</ol>
        </article>;
      })}
    </section>
  </main></div>;
}
