import { Link } from "react-router-dom";

import type { RoomClientStatus } from "../net/roomClient";

export function ConnectionOverlay({ status, gameTitle, coverUrl, onReload }: { status: RoomClientStatus; gameTitle?: string; coverUrl?: string; onReload(): void }) {
  if (status.state === "connected") return null;
  if (status.state === "connecting" || status.state === "loading_release" || status.state === "starting") {
    const step = status.state === "connecting" ? 0 : status.state === "loading_release" ? 1 : 2;
    return <div className="connection-overlay connection-overlay--solid">
      <div className="connection-cover" aria-hidden="true">{coverUrl === undefined ? <span>{gameTitle?.slice(0, 1) ?? "D"}</span> : <img src={coverUrl} alt="" />}</div>
      <p className="eyebrow">Preparing your table</p>
      <h2>{gameTitle ?? status.message}</h2>
      <ol className="loading-steps"><li className={step > 0 ? "done" : "active"}>Fetching release</li><li className={step > 1 ? "done" : step === 1 ? "active" : ""}>Starting Lua</li><li className={step === 2 ? "active" : ""}>Synchronizing</li></ol>
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
