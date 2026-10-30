import { CardActions } from "../components/CardActions";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { HandStrip } from "../components/HandStrip";
import { ConnectionOverlay } from "../components/ConnectionOverlay";
import { TableTopBar } from "../components/TableTopBar";
import { TableMenu } from "../components/TableMenu";
import { AudioControls } from "../components/AudioControls";
import { GameProgressPanel } from "../components/GameProgressPanel";
import { RulebookDialog } from "../components/RulebookDialog";
import { useTableAudio } from "../audio/useTableAudio";
import type { GameSnapshotDto } from "digipology-protocol/http";
import { api } from "../api/client";
import { RoomClient, type RoomClientStatus } from "../net/roomClient";
import { TableScene } from "../scene/TableScene";
import {
  rendererOverrideFromSearch,
  type RendererSelectionReason,
  type RendererStatus,
} from "../scene/rendererPolicy";
import { KernelStore } from "../state/kernelStore";
import { useKernelStore } from "../state/useKernelStore";
import { loadRoomSession, saveRoomSession, type SavedRoomSession } from "../utils/roomSession";
import { localHandId, localHandItems } from "./tableHandModel";
import { gameProgress } from "./gameProgress";
import { inviteUrlForCode } from "../utils/inviteUrl";
import { diceControlLabels } from "./tableContextModel";
import type { CanonicalGameState, EntityRecord, PromptRecord } from "digipology-kernel";

const INITIAL_STATUS: RoomClientStatus = { state: "connecting", message: "Joining Table" };

const RENDERER_REASON_TEXT: Record<RendererSelectionReason, string> = {
  webgpu: "WebGPU is available (webgpu)",
  "no-webgpu": "WebGPU is unavailable (no-webgpu)",
  "override-lite": "Lite was requested by URL override (override-lite)",
  "override-webgl": "WebGL was requested by URL override (override-webgl)",
  "override-lite-no-webgpu": "Lite was requested, but WebGPU is unavailable (override-lite-no-webgpu)",
};

export function RendererDiagnostics({ status }: { status: RendererStatus | null }) {
  return <>
    <dt>Renderer</dt><dd>{status?.mounted ?? "Starting…"}</dd>
    <dt>Selected because</dt><dd>{status === null ? "Renderer selection pending" : RENDERER_REASON_TEXT[status.reason]}</dd>
    <dt>Fallback</dt><dd>{status?.fallback === null || status === null ? "none" : `Lite failed to start: ${status.fallback.error}`}</dd>
    <dt>Tier</dt><dd>{status?.tier ?? "—"}</dd>
  </>;
}

export function playersPanelOpenByDefault(matchesDesktop: boolean): boolean {
  return matchesDesktop;
}

export function openPromptsForPlayer(
  state: CanonicalGameState | null,
  playerId: string,
): PromptRecord[] {
  return Object.values(state?.prompts ?? {})
    .filter((prompt) => prompt.status === "open" && prompt.playerId === playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function DiceControls({
  dice,
  definitions,
  disabled,
  onRoll,
}: {
  dice: readonly EntityRecord[];
  definitions: Readonly<Record<string, { label?: string }>>;
  disabled: boolean;
  onRoll(entityId: string): void;
}) {
  if (dice.length === 0) return null;
  const labels = diceControlLabels(dice, definitions);
  return <aside className="dice-controls"><span>Dice</span>{dice.map((entity) => <div className="dice-controls__die" key={entity.id}><button
    type="button"
    disabled={disabled}
    onClick={() => onRoll(entity.id)}
  >Roll {labels.get(entity.id) ?? "Die"}</button><output aria-label={`${labels.get(entity.id) ?? "Die"} result`}>{String(entity.components.die?.value ?? "—")}</output></div>)}</aside>;
}

export function PromptPanel({
  prompt,
  disabled,
  respond,
}: {
  prompt: PromptRecord;
  disabled: boolean;
  respond: (value: unknown) => void;
}) {
  return <aside className="prompt-panel table-sheet" aria-label="Game choice">
    <span>Decision</span><strong>{prompt.title}</strong>
    {prompt.kind === "choice" ? <div>{(prompt.choices ?? []).map((choice, index) => <button
      type="button"
      disabled={disabled}
      key={`${prompt.id}-${index}`}
      onClick={() => respond(choice)}
    >{typeof choice === "string" ? choice : JSON.stringify(choice)}</button>)}</div> : null}
    {prompt.kind === "confirm" ? <div><button type="button" disabled={disabled} onClick={() => respond(true)}>Yes</button><button type="button" disabled={disabled} onClick={() => respond(false)}>No</button></div> : null}
    {prompt.kind === "number" ? <form onSubmit={(event) => {
      event.preventDefault();
      const value = Number(new FormData(event.currentTarget).get("response"));
      respond(value);
    }}><input name="response" type="number" min={prompt.min} max={prompt.max} step={prompt.step} defaultValue={typeof prompt.default === "number" ? prompt.default : prompt.min} /><button type="submit" disabled={disabled}>Choose</button></form> : null}
  </aside>;
}

export function TablePage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const session = useMemo(() => loadRoomSession(roomId), [roomId]);
  const [clientGeneration, setClientGeneration] = useState(0);
  const store = useMemo(() => new KernelStore(), [clientGeneration, roomId]);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const client = useMemo(() => session === null ? null : new RoomClient(session, store, setStatus), [clientGeneration, session, store]);
  const [projectToTable, setProjectToTable] = useState<((clientX: number, clientY: number) => { x: number; y: number; z: number } | null) | undefined>();
  const view = useKernelStore(store);
  const audio = useTableAudio(store, status.state === "connected", session?.playerId ?? "");
  const [playersOpen, setPlayersOpen] = useState(() => playersPanelOpenByDefault(
    typeof window !== "undefined" && window.matchMedia("(min-width: 769px)").matches,
  ));
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus | null>(null);
  const [openingRound, setOpeningRound] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const pendingRound = useRef<SavedRoomSession | null>(null);
  const rendererOverrideActive = typeof window !== "undefined"
    && rendererOverrideFromSearch(window.location.search) !== null;

  useEffect(() => { client?.start(); return () => client?.stop(); }, [client]);
  useEffect(() => {
    if (view.correction === null) return;
    const id = view.correction.id;
    const timer = setTimeout(() => store.clearCorrection(id), 2_600);
    return () => clearTimeout(timer);
  }, [store, view.correction]);

  if (session === null || client === null) return (
    <div className="join-status"><p className="eyebrow">Table session missing</p><h1>Use an invite to enter</h1><p>This tab does not have a room token. Return home and join with a code.</p><Link className="button-link" to="/">Go home</Link></div>
  );

  const gameTitle = view.gameTitle ?? session.gameTitle;
  const inviteUrl = inviteUrlForCode(session.joinCode, window.location.origin);
  const dice = Object.values(view.state?.entities ?? {}).filter((entity) => entity.components.die !== undefined);
  const handItems = localHandItems(view.displayedState, session.playerId, view.definitions, view.cardDesignsBundle);
  const prompts = openPromptsForPlayer(view.state, session.playerId);
  const progress = gameProgress(view.state);
  const turnDisabled = progress.winnerId !== null || (progress.currentPlayerId !== null && progress.currentPlayerId !== session.playerId);
  const handId = localHandId(view.state, session.playerId);
  const decks = Object.values(view.state?.entities ?? {}).filter((entity) => entity.components.deck?.enabled);
  const hasHands = Object.values(view.state?.entities ?? {}).some((entity) => entity.components.hand);
  async function playAgain() {
    if (!session || openingRound) return;
    setOpeningRound(true); setRoundError(null);
    try {
      if (!pendingRound.current) {
        const result = await api.createRoom({ releaseSlugOrId: session.releaseId, visibility: "private", displayName: view.players.find((player) => player.playerId === session.playerId)?.displayName ?? "Player" });
        if (!result.ok) throw new Error(result.error.message);
        pendingRound.current = { ...result.value, releaseId: session.releaseId, gameTitle };
      }
      const next = pendingRound.current;
      saveRoomSession(next);
      setStatus(INITIAL_STATUS);
      navigate(`/table/${encodeURIComponent(next.roomId)}`);
      pendingRound.current = null;
    } catch (error) { setRoundError(pendingRound.current ? "Your new table is ready, but this browser could not save its session. Allow storage and choose Play again to reopen that same table." : error instanceof Error ? error.message : "The new table could not open. Your finished game is preserved."); }
    finally { setOpeningRound(false); }
  }

  return <TableScene
    store={store} client={client} playerId={session.playerId} interactionsPaused={status.state !== "connected"}
    onProjectorChange={(next) => setProjectToTable(next === null ? undefined : () => next)}
    onRendererStatus={setRendererStatus} rendererStatus={rendererStatus} rendererOverrideActive={rendererOverrideActive}
    topBar={<TableTopBar gameTitle={gameTitle} playerCount={view.players.length} joinCode={session.joinCode} inviteUrl={inviteUrl} onPlayers={() => setPlayersOpen((value) => !value)} onDiagnostics={() => setDiagnosticsOpen((value) => !value)} menu={<><button className="table-rules-button" type="button" aria-label="How to play" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}><span aria-hidden="true">?</span><span className="table-rules-button__label">Rules</span></button><AudioControls {...audio} /><TableMenu roomId={roomId} roomToken={session.roomToken} isHost={view.players.find((player) => player.playerId === session.playerId)?.host === true} scripted={store.requiresScripts()} confirmedSnapshot={() => store.confirmedSnapshot() as GameSnapshotDto | null} onDiagnostics={() => setDiagnosticsOpen((value) => !value)} /></>} />}
    panels={<>
      {rulesOpen ? <RulebookDialog title={gameTitle} rulebook={view.rulebook} onClose={() => setRulesOpen(false)} /> : null}
      <GameProgressPanel state={view.state} playerId={session.playerId} onPlayAgain={() => void playAgain()} opening={openingRound} continuationError={roundError} />
      {view.correction === null ? null : <div key={view.correction.id} className="prediction-correction" role="status">{view.correction.message}</div>}

      <div className="table-bottom-dock">
      {playersOpen ? <aside className="players-panel table-sheet" aria-label="Players"><div className="panel-heading"><span>Players</span><button type="button" aria-label="Close players" onClick={() => setPlayersOpen(false)}>×</button></div>{view.players.map((player) => <div className="player-row" key={player.playerId}><span className={player.connected ? "connection-dot connection-dot--online" : "connection-dot"} /><span><strong>{player.displayName}</strong><small>{player.seatId ?? "No seat"}</small></span><em>{player.connected ? "Connected" : "Away"}</em></div>)}</aside> : null}
      <div className="table-action-controls">
      {progress.winnerId === null ? <DiceControls dice={dice} definitions={view.definitions} disabled={status.state !== "connected" || turnDisabled} onRoll={(entityId) => {
        client.sendAction({ type: "die.roll", payload: { entityId } });
      }} /> : null}
      {progress.winnerId === null ? <CardActions entities={Object.values(view.displayedState?.entities ?? {})} handId={handId} disabled={status.state !== "connected"} {...(view.cardDesignsBundle !== undefined ? { designs: view.cardDesignsBundle } : {})} onAction={(action) => client.sendAction(action)} /> : null}
      </div>

      {hasHands ? <HandStrip key={roomId} items={handItems} roomId={roomId} client={client} interactionsPaused={status.state !== "connected"} {...(projectToTable === undefined ? {} : { projectToTable })} /> : null}
      </div>
      {(progress.winnerId === null ? prompts : []).map((prompt) => <PromptPanel key={prompt.id} prompt={prompt} disabled={status.state !== "connected"} respond={(response) => {
        client.sendAction({ type: "prompt.respond", payload: { promptId: prompt.id, response } });
      }} />)}
      {diagnosticsOpen ? <aside className="diagnostics-panel table-sheet" aria-label="Diagnostics"><div className="panel-heading"><span>Diagnostics</span><button type="button" aria-label="Close diagnostics" onClick={() => setDiagnosticsOpen(false)}>×</button></div><dl><dt>Sequence</dt><dd>{view.state?.sequence ?? "—"}</dd><dt>State hash</dt><dd>{view.stateHash ?? "—"}</dd><dt>Pending</dt><dd>{view.pendingRequestIds.size}</dd><dt>Transport</dt><dd>{status.state}</dd><RendererDiagnostics status={rendererStatus} /></dl><p>{view.diagnostic ?? "No diagnostics yet."}</p></aside> : null}
    </>}
    overlay={status.state === "connected" ? null : <ConnectionOverlay status={status} onReload={() => {
      client.stop();
      setStatus(INITIAL_STATUS);
      setClientGeneration((value) => value + 1);
    }} />}
  />;
}
