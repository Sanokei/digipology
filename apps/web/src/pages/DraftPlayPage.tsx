import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { loadEditorDraft, saveEditorDraft, serializeEditorDraft } from "../editor/state/persistence";
import { downloadBlob } from "../editor/state/artwork";
import { GameArtworkDialog } from "../artwork/GameArtworkDialog";
import { useDraftArtworkGeneration } from "../artwork/useDraftArtworkGeneration";
import { artworkJobsReady, type ArtworkDraft } from "../artwork/model";
import { CARD_BACK_PATH } from "../scene/cardBack";
import { PlaytestController, usePlaytestSnapshot } from "../editor/playtest/PlaytestController";
import { useKernelStore } from "../state/useKernelStore";
import { TableScene } from "../scene/TableScene";
import { GameProgressPanel } from "../components/GameProgressPanel";
import { ReadingDialog, RulebookDialog } from "../components/RulebookDialog";
import { HandStrip } from "../components/HandStrip";
import { AudioControls } from "../components/AudioControls";
import { useTableAudio } from "../audio/useTableAudio";
import { DiceControls, PromptPanel, openPromptsForPlayer } from "./TablePage";
import { localHandId, localHandItems } from "./tableHandModel";
import { gameProgress } from "./gameProgress";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { saveRoomSession } from "../utils/roomSession";
import { publishDraftAndHost, type DraftPublicationStage } from "./generatedDraft";
import { draftReview } from "./draftReview";
import "./draftPlay.css";

export function DraftPlayPage() {
  const { draftId = "" } = useParams();
  const draft = useMemo(() => loadEditorDraft(localStorage, draftId), [draftId]);
  if (!draft) return <main className="join-status"><p className="eyebrow">Private draft</p><h1>This draft is not in this browser</h1><p>Open it in the browser where you created it, or create a new game.</p><Link className="button-link" to="/create">Create a game</Link></main>;
  return <DraftPlayContent key={draftId} initialDraft={draft} />;
}

function DraftPlayContent({ initialDraft }: { initialDraft: ArtworkDraft }) {
  const draftId = initialDraft.id;
  const [draft, setDraft] = useState<ArtworkDraft>(initialDraft);
  const controller = useMemo(() => new PlaytestController(), [draftId]);
  const runtime = usePlaytestSnapshot(controller);
  const view = useKernelStore(controller.projection);
  const [players, setPlayers] = useState(draft?.minPlayers ?? 2);
  const [rules, setRules] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryStage, setRetryStage] = useState<DraftPublicationStage>("publication");
  const [projector, setProjector] = useState<((x: number, y: number) => { x: number; y: number; z: number } | null) | undefined>();
  const audio = useTableAudio(controller.projection, runtime.status === "playing", runtime.playerId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bar = useRef<HTMLElement>(null);
  const artwork = useDraftArtworkGeneration({ draft, api, enabled: user !== null,
    onDraftChange: (next) => setDraft(next), persistDraft: (next) => saveEditorDraft(localStorage, next) });
  const cardBack = draft.bundle.files.find((file) => file.path === CARD_BACK_PATH)?.content ?? null;
  useEffect(() => { controller.projection.setCardBackBundle(cardBack); }, [controller, cardBack, runtime.status]);
  useEffect(() => {
    const header = bar.current;
    const root = header?.closest<HTMLElement>(".table-scene");
    if (!header || !root) return;
    const update = () => root.style.setProperty("--draft-toolbar-bottom", `${header.getBoundingClientRect().bottom + 12}px`);
    const observer = new ResizeObserver(update);
    observer.observe(header); update();
    return () => { observer.disconnect(); root.style.removeProperty("--draft-toolbar-bottom"); };
  }, [draft]);
  useEffect(() => {
    setPlayers(initialDraft.minPlayers);
    void controller.start(initialDraft, { playerCount: initialDraft.minPlayers });
    return () => controller.dispose();
  }, [controller, initialDraft]);
  const progress = gameProgress(view.state);
  const review = draftReview(draft);
  const paused = runtime.status !== "playing";
  const wrongTurn = progress.winnerId !== null || (progress.currentPlayerId !== null && progress.currentPlayerId !== runtime.playerId);
  const handId = localHandId(view.state, runtime.playerId);
  const hand = localHandItems(view.displayedState, runtime.playerId, view.definitions);
  const entities = Object.values(view.state?.entities ?? {});
  const restart = () => { controller.stop(); void controller.start(draft, { playerCount: players }); };
  async function publish() {
    if (!draft) return;
    if (!user) { navigate("/login", { state: { backgroundLocation: location } }); return; }
    setPublishing(true); setNotice(null);
    const result = await publishDraftAndHost(api, artwork.currentDraft(), window.location.origin);
    setPublishing(false);
    if (!result.ok) { setRetryStage(result.stage); setNotice(result.error.message); return; }
    try { saveRoomSession(result.value); navigate(`/table/${encodeURIComponent(result.value.roomId)}`); }
    catch { setRetryStage("table"); setNotice("Your game is published. This browser could not save its table session. Allow browser storage and retry to open it."); }
  }
  const warning = runtime.logs.filter((entry) => entry.level !== "info").at(-1);
  const artworkIncomplete = !!draft.artworkGeneration && !artworkJobsReady(draft);
  const artworkBusy = user !== null && (artwork.activity !== null || (!!draft.artworkGeneration?.direction && Object.values(draft.artworkGeneration.jobs).some((job) => job.status === "pending" || job.status === "running")));
  return <TableScene store={controller.projection} client={controller} playerId={runtime.playerId} interactionsPaused={paused}
    onProjectorChange={(next) => setProjector(next === null ? undefined : () => next)}
    topBar={<header className="draft-play-bar" ref={bar}>
      <div className="draft-play-bar__title"><Link to="/create" aria-label="Back to creation">←</Link><div><small>Draft saved here · reopening resets the playtest</small><strong>{draft.title}</strong>{draft.tagline ? <span className="draft-play-bar__tagline" title={draft.tagline}>{draft.tagline}</span> : null}</div></div>
      <div className="draft-play-bar__actions"><button type="button" onClick={() => setRules(true)}>How to play</button>{review ? <button type="button" className="draft-play-review-button" aria-label="Review playtest" onClick={() => setReviewOpen(true)}>{review.stale ? "Review your changes" : `Review playtest · ${review.suggestions.length}`}</button> : null}<button type="button" className="draft-artwork-button" aria-label="Edit artwork" onClick={() => setArtworkOpen(true)}>{draft.artwork?.status === "ready" ? <img className="draft-artwork-thumb" src={draft.artwork.dataUrl} alt={`${draft.title} cover`} /> : null}{draft.artwork?.status === "unavailable" ? "Repair artwork" : artwork.activity === "review" ? "Checking game…" : artwork.activity ? "Creating artwork…" : draft.artworkGeneration && Object.values(draft.artworkGeneration.jobs).some((job) => job.status !== "ready" && job.status !== "not-needed") ? "Artwork pending" : "Artwork"}</button><AudioControls {...audio} /><Link to={`/edit/${encodeURIComponent(draft.id)}`}>Edit</Link>{artworkIncomplete ? <span className="draft-artwork-pending" role="status">Artwork pending · publishing uses ready images</span> : null}<button type="button" disabled={publishing || artworkBusy || draft.artwork?.status === "unavailable"} onClick={() => void publish()}>{publishing ? "Opening table…" : artworkIncomplete ? "Publish draft & invite" : "Publish & invite"}</button></div>
      <div className="draft-play-bar__seats"><label>Play as<select aria-label="Play as" value={runtime.playerId} disabled={paused} onChange={(event) => controller.selectPlayer(event.currentTarget.value)}>{view.players.map((player) => <option value={player.playerId} key={player.playerId}>{player.displayName}</option>)}</select></label>
        <label>Players<select aria-label="Playtest player count" value={players} onChange={(event) => setPlayers(Number(event.currentTarget.value))}>{Array.from({ length: draft.maxPlayers - draft.minPlayers + 1 }, (_, index) => draft.minPlayers + index).map((count) => <option key={count}>{count}</option>)}</select></label><button type="button" disabled={runtime.status === "starting"} onClick={restart}>Restart playtest</button><button type="button" disabled={paused} onClick={() => controller.tick()}>Advance time</button><span>Try each seat here. Publish an unlisted game to invite friends.</span></div>
    </header>}
    panels={<>
      {artworkOpen ? <GameArtworkDialog draft={draft} controller={artwork} canGenerate={user !== null}
        onSignIn={() => navigate("/login", { state: { backgroundLocation: location } })}
        onDownloadDraft={() => downloadBlob(new Blob([serializeEditorDraft(artwork.currentDraft())], { type: "application/json" }), "game-draft.editor.json")}
        onClose={() => setArtworkOpen(false)} /> : null}
      {rules ? <RulebookDialog title={draft.title} rulebook={view.rulebook} onClose={() => setRules(false)} /> : null}
      {reviewOpen && review ? <ReadingDialog heading="Try these at the table" eyebrow={review.stale ? "Your draft changed" : "Playtest review"} closeLabel="Close playtest review" bodyLabel="Suggested playtests" onClose={() => setReviewOpen(false)}>
        <p>{review.stale ? "The rules or setup changed after the automated playtest. Give your changes a fresh playthrough." : "Some checks still need a playthrough. Try these before you invite friends."}</p>
        <ul>{review.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
      </ReadingDialog> : null}
      <GameProgressPanel state={view.state} playerId={runtime.playerId} onPlayAgain={restart} continuationHint="Starts a fresh private playtest with the same game and players." />
      {notice ? <div className="draft-play-notice" role="alert">{notice}<button type="button" disabled={publishing} onClick={() => void publish()}>{retryStage === "artwork" ? "Retry artwork publication" : retryStage === "table" ? "Retry opening table" : "Retry publication"}</button></div> : null}
      {warning ? <p className="draft-play-warning" role="status">{warning.message}</p> : null}
      <div className="table-bottom-dock">
      {progress.winnerId === null ? <DiceControls dice={entities.filter((entity) => entity.components.die)} definitions={view.definitions} disabled={paused || wrongTurn} onRoll={(entityId) => controller.sendAction({ type: "die.roll", payload: { entityId } })} /> : null}
      {progress.winnerId === null && entities.some((entity) => entity.components.deck?.enabled) ? <aside className="card-controls dice-controls" aria-label="Card actions"><span>Cards</span>{entities.filter((entity) => entity.components.deck?.enabled).map((deck) => <div key={deck.id}><button type="button" disabled={paused || !handId || !deck.components.container?.items.length} onClick={() => controller.sendAction({ type: "deck.draw_to_container", payload: { deckId: deck.id, target: handId, count: 1 } })}>Draw card</button><button type="button" disabled={paused} onClick={() => controller.sendAction({ type: "deck.shuffle", payload: { deckId: deck.id } })}>Shuffle deck</button></div>)}</aside> : null}
      {handId ? <HandStrip key={`${draftId}:${runtime.playerId}`} items={hand} roomId={`draft-${draftId}`} client={controller} interactionsPaused={paused} {...(projector ? { projectToTable: projector } : {})} /> : null}
      </div>
      {progress.winnerId === null && entities.some((entity) => entity.components.button) ? <aside className="draft-action-buttons" aria-label="Game actions">{entities.filter((entity) => entity.components.button).map((entity) => <button type="button" key={entity.id} disabled={paused || !entity.components.button?.enabled} onClick={() => controller.sendAction({ type: "button.press", payload: { entityId: entity.id } })}>{entity.components.button?.label || "Choose"}</button>)}</aside> : null}
      {(progress.winnerId === null ? openPromptsForPlayer(view.state, runtime.playerId) : []).map((prompt) => <PromptPanel key={prompt.id} prompt={prompt} disabled={paused} respond={(response) => controller.sendAction({ type: "prompt.respond", payload: { promptId: prompt.id, response } })} />)}

    </>}
    overlay={runtime.error ? <div className="connection-overlay"><div className="reconnect-card" role="alert"><h2>The playtest could not start</h2><p>{runtime.error}</p><button type="button" onClick={restart}>Retry playtest</button><Link to={`/edit/${encodeURIComponent(draft.id)}`}>Edit this draft</Link></div></div>
      : runtime.status === "starting" ? <div className="connection-overlay"><div className="reconnect-card" role="status">Preparing your game…</div></div> : null}
  />;
}
