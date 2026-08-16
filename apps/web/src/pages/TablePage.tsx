import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { HandStrip } from "../components/HandStrip";
import { TableTopBar } from "../components/TableTopBar";
import { RoomClient, type RoomClientStatus } from "../net/roomClient";
import { TableScene } from "../scene/TableScene";
import {
  rendererOverrideFromSearch,
  type RendererSelectionReason,
  type RendererStatus,
} from "../scene/rendererPolicy";
import { KernelStore } from "../state/kernelStore";
import { useKernelStore } from "../state/useKernelStore";
import { loadRoomSession } from "../utils/roomSession";
import { localHandItems } from "./tableHandModel";
import type { CanonicalGameState, PromptRecord } from "digipology-kernel";

const INITIAL_STATUS: RoomClientStatus = { state: "connecting", message: "Connecting to table" };

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

function PromptPanel({
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
  const session = useMemo(() => loadRoomSession(roomId), [roomId]);
  const store = useMemo(() => new KernelStore(), [roomId]);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const client = useMemo(() => session === null ? null : new RoomClient(session, store, setStatus), [session, store]);
  const view = useKernelStore(store);
  const [playersOpen, setPlayersOpen] = useState(() => playersPanelOpenByDefault(
    typeof window !== "undefined" && window.matchMedia("(min-width: 769px)").matches,
  ));
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus | null>(null);
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

  const loading = status.state === "connecting" || status.state === "loading_release" || status.state === "starting";
  const interrupted = status.state === "reconnecting" || status.state === "error" || status.state === "ended";
  const gameTitle = view.gameTitle ?? session.gameTitle;
  const dice = Object.values(view.state?.entities ?? {}).filter((entity) => entity.components.die !== undefined);
  const handItems = localHandItems(view.displayedState, session.playerId, view.definitions);
  const prompts = openPromptsForPlayer(view.state, session.playerId);

  return <TableScene
    store={store} client={client} interactionsPaused={status.state !== "connected"}
    onRendererStatus={setRendererStatus} rendererStatus={rendererStatus} rendererOverrideActive={rendererOverrideActive}
    topBar={<TableTopBar gameTitle={gameTitle} playerCount={view.players.length} joinCode={session.joinCode} inviteUrl={session.inviteUrl} onPlayers={() => setPlayersOpen((value) => !value)} onDiagnostics={() => setDiagnosticsOpen((value) => !value)} />}
    panels={<>
      {view.correction === null ? null : <div key={view.correction.id} className="prediction-correction" role="status">{view.correction.message}</div>}
      {playersOpen ? <aside className="players-panel table-sheet" aria-label="Players"><div className="panel-heading"><span>Players</span><button type="button" aria-label="Close players" onClick={() => setPlayersOpen(false)}>×</button></div>{view.players.map((player) => <div className="player-row" key={player.playerId}><span className={player.connected ? "connection-dot connection-dot--online" : "connection-dot"} /><span><strong>{player.displayName}</strong><small>{player.seatId ?? "No seat"}</small></span><em>{player.connected ? "Connected" : "Away"}</em></div>)}</aside> : null}
      {dice.length > 0 ? <aside className="dice-controls"><span>Dice</span>{dice.map((entity) => <button type="button" disabled={status.state !== "connected"} key={entity.id} onClick={() => {
        client.sendAction({ type: "die.roll", payload: { entityId: entity.id } });
      }}>Roll {entity.id}</button>)}</aside> : null}
      {prompts.map((prompt) => <PromptPanel key={prompt.id} prompt={prompt} disabled={status.state !== "connected"} respond={(response) => {
        client.sendAction({ type: "prompt.respond", payload: { promptId: prompt.id, response } });
      }} />)}
      {diagnosticsOpen ? <aside className="diagnostics-panel table-sheet" aria-label="Diagnostics"><div className="panel-heading"><span>Diagnostics</span><button type="button" aria-label="Close diagnostics" onClick={() => setDiagnosticsOpen(false)}>×</button></div><dl><dt>Sequence</dt><dd>{view.state?.sequence ?? "—"}</dd><dt>State hash</dt><dd>{view.stateHash ?? "—"}</dd><dt>Pending</dt><dd>{view.pendingRequestIds.size}</dd><dt>Transport</dt><dd>{status.state}</dd><RendererDiagnostics status={rendererStatus} /></dl><p>{view.diagnostic ?? "No diagnostics yet."}</p></aside> : null}
      <HandStrip items={handItems} />
    </>}
    overlay={loading ? <div className="connection-overlay connection-overlay--solid"><div className="loading-spinner" /><p className="eyebrow">{status.state.replace("_", " ")}</p><h2>{status.message}</h2><ol className="loading-steps"><li className={status.state === "connecting" ? "active" : "done"}>Connecting</li><li className={status.state === "loading_release" ? "active" : status.state === "starting" ? "done" : ""}>Loading release</li><li className={status.state === "starting" ? "active" : ""}>Starting simulation</li></ol></div> : interrupted ? <div className="connection-overlay"><div className="reconnect-card"><span className="connection-pulse" /><h2>{status.message}</h2><p>{status.detail ?? (status.state === "reconnecting" ? "The table stays visible while we catch up. Canonical interactions are paused." : status.state === "ended" ? "No further actions can be played." : "Try returning home and reopening the invite.")}</p>{status.state === "error" ? <button type="button" onClick={() => client.start()}>Try again</button> : null}{status.state === "ended" || status.state === "error" ? <Link className="button-link" to="/">Leave table</Link> : null}</div></div> : null}
  />;
}
