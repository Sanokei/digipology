import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { TableTopBar } from "../components/TableTopBar";
import { RoomClient, type RoomClientStatus } from "../net/roomClient";
import { TableScene } from "../scene/TableScene";
import { KernelStore } from "../state/kernelStore";
import { useKernelStore } from "../state/useKernelStore";
import { loadRoomSession } from "../utils/roomSession";

const INITIAL_STATUS: RoomClientStatus = { state: "connecting", message: "Connecting to table" };

export function TablePage() {
  const { roomId = "" } = useParams();
  const session = useMemo(() => loadRoomSession(roomId), [roomId]);
  const store = useMemo(() => new KernelStore(), [roomId]);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const client = useMemo(() => session === null ? null : new RoomClient(session, store, setStatus), [session, store]);
  const view = useKernelStore(store);
  const [playersOpen, setPlayersOpen] = useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

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

  return <TableScene
    store={store} client={client} interactionsPaused={status.state !== "connected"}
    topBar={<TableTopBar gameTitle={gameTitle} playerCount={view.players.length} joinCode={session.joinCode} inviteUrl={session.inviteUrl} onPlayers={() => setPlayersOpen((value) => !value)} onDiagnostics={() => setDiagnosticsOpen((value) => !value)} />}
    panels={<>
      {view.correction === null ? null : <div key={view.correction.id} className="prediction-correction" role="status">{view.correction.message}</div>}
      {playersOpen ? <aside className="players-panel"><div className="panel-heading"><span>Players</span><button type="button" onClick={() => setPlayersOpen(false)}>×</button></div>{view.players.map((player) => <div className="player-row" key={player.playerId}><span className={player.connected ? "connection-dot connection-dot--online" : "connection-dot"} /><span><strong>{player.displayName}</strong><small>{player.seatId ?? "No seat"}</small></span><em>{player.connected ? "Connected" : "Away"}</em></div>)}</aside> : null}
      {dice.length > 0 ? <aside className="dice-controls"><span>Dice</span>{dice.map((entity) => <button type="button" disabled={status.state !== "connected"} key={entity.id} onClick={() => {
        client.sendAction({ type: "die.roll", payload: { entityId: entity.id } });
      }}>Roll {entity.id}</button>)}</aside> : null}
      {diagnosticsOpen ? <aside className="diagnostics-panel"><div className="panel-heading"><span>Diagnostics</span><button type="button" onClick={() => setDiagnosticsOpen(false)}>×</button></div><dl><dt>Sequence</dt><dd>{view.state?.sequence ?? "—"}</dd><dt>State hash</dt><dd>{view.stateHash ?? "—"}</dd><dt>Pending</dt><dd>{view.pendingRequestIds.size}</dd><dt>Transport</dt><dd>{status.state}</dd></dl><p>{view.diagnostic ?? "No diagnostics yet."}</p></aside> : null}
    </>}
    overlay={loading ? <div className="connection-overlay connection-overlay--solid"><div className="loading-spinner" /><p className="eyebrow">{status.state.replace("_", " ")}</p><h2>{status.message}</h2><ol className="loading-steps"><li className={status.state === "connecting" ? "active" : "done"}>Connecting</li><li className={status.state === "loading_release" ? "active" : status.state === "starting" ? "done" : ""}>Loading release</li><li className={status.state === "starting" ? "active" : ""}>Starting simulation</li></ol></div> : interrupted ? <div className="connection-overlay"><div className="reconnect-card"><span className="connection-pulse" /><h2>{status.message}</h2><p>{status.state === "reconnecting" ? "The table stays visible while we catch up. Canonical interactions are paused." : status.state === "ended" ? "No further actions can be played." : "Try returning home and reopening the invite."}</p>{status.state === "ended" || status.state === "error" ? <Link className="button-link" to="/">Leave table</Link> : null}</div></div> : null}
  />;
}
