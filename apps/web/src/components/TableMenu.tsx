import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { GameSnapshotDto } from "digipology-protocol/http";

import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function TableMenuContent({ isHost, signedIn, saveHidden, scripted, busy, onDiagnostics, onSave, onEnd }: {
  isHost: boolean; signedIn: boolean; saveHidden: boolean; scripted: boolean; busy: boolean;
  onDiagnostics(): void; onSave(): void; onEnd(): void;
}) {
  return <div className="table-menu__sheet table-sheet" role="menu">
    <button type="button" role="menuitem" onClick={onDiagnostics}>Diagnostics</button>
    {isHost && !saveHidden ? <button type="button" role="menuitem" disabled={busy} onClick={onSave}>
      {signedIn ? busy ? "Saving…" : "Save table" : "Sign in to save this table"}
    </button> : null}
    {isHost && scripted && !saveHidden ? <p className="table-menu__note">Scripted games can't be resumed yet — you can save now and resume once support lands.</p> : null}
    {isHost ? <button type="button" role="menuitem" disabled={busy} onClick={onEnd}>End table</button> : null}
    <Link role="menuitem" to="/">Leave</Link>
  </div>;
}

export function TableMenu({ roomId, roomToken, isHost, scripted, confirmedSnapshot, onDiagnostics }: {
  roomId: string; roomToken: string; isHost: boolean; scripted: boolean;
  confirmedSnapshot(): GameSnapshotDto | null; onDiagnostics(): void;
}) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingSignIn, setPendingSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveHidden, setSaveHidden] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!window.confirm(scripted
      ? "Save this table? Scripted games can't be resumed yet — the save is kept until resume support lands."
      : "Save this table? You can resume it later from Saved tables.")) return;
    setBusy(true); setNotice(null);
    let result = await api.saveTable(roomId, roomToken, confirmedSnapshot() ?? undefined);
    if (!result.ok && result.error.code === "save_stale") {
      result = await api.saveTable(roomId, roomToken, confirmedSnapshot() ?? undefined);
    }
    setBusy(false);
    if (result.ok) setNotice("saved");
    else if (result.error.code === "save_host_only") setSaveHidden(true);
    else setNotice(result.error.message);
  }, [confirmedSnapshot, roomId, roomToken, scripted]);

  useEffect(() => {
    if (!pendingSignIn) return;
    const check = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [pendingSignIn, refresh]);

  useEffect(() => {
    if (!pendingSignIn || user === null) return;
    setPendingSignIn(false);
    void save();
  }, [pendingSignIn, save, user]);

  function requestSave() {
    if (user !== null) { void save(); return; }
    setPendingSignIn(true);
    navigate("/login", { state: { backgroundLocation: location } });
  }

  async function endTable() {
    if (!window.confirm("End this table for everyone?")) return;
    setBusy(true);
    const result = await api.endTable(roomId, roomToken);
    setBusy(false);
    if (result.ok) navigate("/"); else setNotice(result.error.message);
  }

  return <details className="table-menu">
    <summary className="icon-button" aria-label="Open table menu">•••</summary>
    <TableMenuContent isHost={isHost} signedIn={user !== null} saveHidden={saveHidden} scripted={scripted} busy={busy}
      onDiagnostics={onDiagnostics} onSave={requestSave} onEnd={() => void endTable()} />
    {notice === "saved" ? <div className="table-menu__toast" role="status">Saved · <Link to="/saves">View saved tables</Link></div>
      : notice === null ? null : <div className="table-menu__toast" role="alert">{notice}</div>}
  </details>;
}
