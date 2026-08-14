import { Link } from "react-router-dom";

export function TableTopBar({ gameTitle, playerCount, joinCode, inviteUrl, onPlayers, onDiagnostics }: { gameTitle: string; playerCount: number; joinCode: string; inviteUrl: string; onPlayers(): void; onDiagnostics(): void }) {
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); }
    catch { /* Clipboard can be unavailable in non-secure development contexts. */ }
  }
  return (
    <header className="table-topbar">
      <div className="table-topbar__game"><Link className="table-topbar__back" to="/" aria-label="Leave table"><span aria-hidden="true">←</span></Link><div><span className="table-topbar__label">Game</span><strong>{gameTitle}</strong></div></div>
      <div className="table-topbar__actions">
        <button className="table-topbar__players" type="button" onClick={onPlayers} aria-label={`Show ${playerCount} ${playerCount === 1 ? "player" : "players"}`}><span className="presence-dot" aria-hidden="true" /><span className="table-topbar__players-label">{playerCount} {playerCount === 1 ? "player" : "players"}</span><span className="table-topbar__players-count" aria-hidden="true">{playerCount}</span></button>
        <button className="table-topbar__invite" type="button" onClick={() => void copyInvite()} title={inviteUrl}><span className="table-topbar__invite-label">Invite · </span>{joinCode}</button>
        <button className="icon-button" type="button" onClick={onDiagnostics} aria-label="Open diagnostics">•••</button>
      </div>
    </header>
  );
}
