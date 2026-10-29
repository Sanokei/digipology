import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function TableTopBar({ gameTitle, playerCount, joinCode, inviteUrl, onPlayers, onDiagnostics, menu }: { gameTitle: string; playerCount: number; joinCode: string; inviteUrl: string; onPlayers(): void; onDiagnostics(): void; menu?: ReactNode }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 3_000);
    return () => clearTimeout(timer);
  }, [copyState]);
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }
  return (
    <header className="table-topbar">
      <div className="table-topbar__game"><Link className="table-topbar__back" to="/" aria-label="Leave table"><span aria-hidden="true">←</span></Link><div><span className="table-topbar__label">Game</span><strong>{gameTitle}</strong></div></div>
      <div className="table-topbar__actions">
        <button className="table-topbar__players" type="button" onClick={onPlayers} aria-label={`Show ${playerCount} ${playerCount === 1 ? "player" : "players"}`}><span className="presence-dot" aria-hidden="true" /><span className="table-topbar__players-label">{playerCount} {playerCount === 1 ? "player" : "players"}</span><span className="table-topbar__players-count" aria-hidden="true">{playerCount}</span></button>
        <div className="table-invite"><button className="table-topbar__invite" type="button" aria-label="Copy invite link" onClick={() => void copyInvite()} title={inviteUrl}><span className="table-topbar__invite-label">Invite · </span>{joinCode}</button>{copyState === "idle" ? null : <span className="table-invite__notice" role="status">{copyState === "copied" ? "Invite link copied" : `Couldn't copy. Share code ${joinCode}.`}</span>}</div>
        {menu ?? <button className="icon-button" type="button" onClick={onDiagnostics} aria-label="Open diagnostics">•••</button>}
      </div>
    </header>
  );
}
