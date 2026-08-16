import { Link } from "react-router-dom";

import type { RoomClientStatus } from "../net/roomClient";

export function ConnectionOverlay({ status, onReload }: { status: RoomClientStatus; onReload(): void }) {
  if (status.state === "connected") return null;
  if (status.state === "connecting" || status.state === "loading_release" || status.state === "starting") {
    const label = status.state === "loading_release" ? "Loading Game" : "Joining Table";
    return <div className="connection-overlay connection-overlay--solid">
      <div className="loading-spinner" />
      <p className="eyebrow">{label}</p>
      <h2>{status.message}</h2>
      <ol className="loading-steps"><li className={status.state === "loading_release" ? "done" : "active"}>Joining Table</li><li className={status.state === "loading_release" ? "active" : status.state === "starting" ? "done" : ""}>Loading Game</li></ol>
    </div>;
  }
  const passthrough = status.state === "reconnecting" || status.state === "synchronizing";
  const title = status.state === "reconnecting" ? "Reconnecting" : status.state === "synchronizing" ? "Synchronizing Table" : status.message;
  return <div className={`connection-overlay${passthrough ? " connection-overlay--passthrough" : ""}`}>
    <div className="reconnect-card">
      {status.state === "ended" || status.state === "error" ? null : <span className="connection-pulse" />}
      <h2>{title}</h2>
      <p>{status.state === "reconnecting"
        ? "The table stays visible while we reconnect. Game actions are paused."
        : status.state === "synchronizing"
          ? status.progress === undefined ? "Catching up with the latest table actions." : `${status.progress.applied} / ${status.progress.total} actions applied`
          : status.detail ?? (status.state === "ended" ? "No further actions can be played." : "You can reload the table or leave safely.")}</p>
      {status.state === "error" && status.recoverable === true ? <button type="button" onClick={onReload}>Reload table</button> : null}
      {status.state === "ended" || status.state === "error" ? <Link className="button-link" to="/">Leave table</Link> : null}
    </div>
  </div>;
}
