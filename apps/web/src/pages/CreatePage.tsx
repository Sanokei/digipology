import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { OwnedGameDto, UploadValidationReportItem } from "digipology-protocol/http";

import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SiteHeader } from "../components/SiteHeader";
import { prevalidateCreateGame, prevalidateRelease } from "../releaseValidation";
import { saveRoomSession } from "../utils/roomSession";
import { nextVisibility, ownedGameRoomSession } from "./creatorModel";

export function ValidationReport({ report }: { report: UploadValidationReportItem[] }) {
  return <ul className="validation-report" aria-label="Upload validation report">
    {report.map((item) => <li className={item.ok ? "validation-ok" : "validation-failed"} key={item.check}>
      <strong>{item.ok ? "Pass" : "Fail"}</strong> {item.check.replaceAll("_", " ")}
      {item.detail === undefined ? null : <small>{item.detail}</small>}
    </li>)}
  </ul>;
}
export function CreatePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [slug, setSlug] = useState("");
  const [minPlayers, setMinPlayers] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [bundleText, setBundleText] = useState("");
  const [report, setReport] = useState<UploadValidationReportItem[]>([]);
  const [games, setGames] = useState<OwnedGameDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadGames = useCallback(async () => {
    if (user === null) return;
    const result = await api.listMyGames();
    if (result.ok) setGames(result.value.games);
    else setMessage(result.error.message);
  }, [user]);
  useEffect(() => { void loadGames(); }, [loadGames]);

  function validate() {
    const result = prevalidateCreateGame({ title, tagline, slug, minPlayers, maxPlayers }, bundleText);
    setReport(result.report);
    return result;
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
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
    await loadGames();
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    setBundleText(await file.text());
    setReport([]);
  }

  async function toggle(game: OwnedGameDto) {
    const visibility = nextVisibility(game);
    const result = await api.updateGameVisibility(game.slug, visibility);
    if (!result.ok) { setMessage(result.error.message); return; }
    setGames((current) => current.map((candidate) => candidate.slug === game.slug ? result.value.game : candidate));
  }

  async function host(game: OwnedGameDto) {
    const result = await api.createRoom({ releaseSlugOrId: game.latestReleaseId, visibility: "private" });
    if (!result.ok) { setMessage(result.error.message); return; }
    saveRoomSession(ownedGameRoomSession(game, result.value));
    navigate(`/table/${encodeURIComponent(result.value.roomId)}`);
  }

  async function publishRelease(game: OwnedGameDto, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    const checked = prevalidateRelease(await file.text(), game.minPlayers, game.maxPlayers);
    setReport(checked.report);
    if (checked.bundle === null) { setMessage("The release failed client-side validation."); return; }
    const result = await api.createRelease(game.slug, checked.bundle);
    if (!result.ok) {
      if (result.error.report !== undefined) setReport(result.error.report);
      setMessage(result.error.message);
      return;
    }
    setMessage(`${game.title} release ${result.value.release.releaseNumber} is published.`);
    await loadGames();
  }

  if (loading) return <div className="site-page"><SiteHeader /><main className="creator-page"><p>Checking your account…</p></main></div>;
  if (user === null) return <div className="site-page"><SiteHeader /><main className="creator-page"><section className="dialog-card"><p className="eyebrow">Creator upload</p><h1>Sign in to publish</h1><p>Publishing and managing community games requires an account.</p><Link className="button-link" to="/login">Sign in</Link></section></main></div>;

  return <div className="site-page"><SiteHeader /><main className="creator-page">
    <section className="creator-panel">
      <p className="eyebrow">Creator upload</p><h1>Publish a game</h1>
      <p>Choose a release JSON file or paste the same JSON below. Validation runs locally before upload.</p>
      <form className="stack-form" onSubmit={(event) => void publish(event)}>
        <label htmlFor="game-title">Title</label><input id="game-title" maxLength={80} required value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        <label htmlFor="game-tagline">Tagline</label><input id="game-tagline" maxLength={240} value={tagline} onChange={(event) => setTagline(event.currentTarget.value)} />
        <label htmlFor="game-slug">Slug <small>(optional)</small></label><input id="game-slug" maxLength={48} placeholder="generated-from-title" value={slug} onChange={(event) => setSlug(event.currentTarget.value)} />
        <div className="field-pair"><label>Minimum players<input type="number" min={1} max={64} value={minPlayers} onChange={(event) => setMinPlayers(event.currentTarget.valueAsNumber)} /></label><label>Maximum players<input type="number" min={1} max={64} value={maxPlayers} onChange={(event) => setMaxPlayers(event.currentTarget.valueAsNumber)} /></label></div>
        <label htmlFor="bundle-file">Release JSON file</label><input id="bundle-file" type="file" accept="application/json,.json" onChange={(event) => void readFile(event)} />
        <label htmlFor="bundle-json">Release JSON</label><textarea id="bundle-json" rows={12} value={bundleText} onChange={(event) => { setBundleText(event.currentTarget.value); setReport([]); }} />
        <div className="button-row"><button type="button" className="secondary-button" onClick={validate}>Validate</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Publishing…" : "Publish release 1"}</button></div>
      </form>
      {message === null ? null : <p className="form-notice" role="status">{message}</p>}
      {report.length === 0 ? null : <ValidationReport report={report} />}
    </section>
    <section className="creator-panel" aria-labelledby="my-games-title">
      <p className="eyebrow">Library</p><h2 id="my-games-title">My games</h2>
      {games.length === 0 ? <p>No uploads yet.</p> : games.map((game) => <article className="my-game" key={game.slug}>
        <div><h3>{game.title}</h3><p>{game.tagline}</p><small>{game.visibility} · latest release {game.releases[0]?.releaseNumber}</small></div>
        <div className="button-row"><button className="secondary-button" type="button" onClick={() => void toggle(game)}>{game.visibility === "public" ? "Make unlisted" : "Make public"}</button><button className="primary-button" type="button" onClick={() => void host(game)}>Host</button><label className="file-button">New release<input type="file" accept="application/json,.json" onChange={(event) => void publishRelease(game, event)} /></label></div>
        <ol className="release-list">{game.releases.map((release) => <li key={release.releaseId}><strong>Release {release.releaseNumber}</strong><span>{new Date(release.createdAt).toLocaleDateString()}</span><code>{release.releaseId}</code></li>)}</ol>
      </article>)}
    </section>
  </main></div>;
}
