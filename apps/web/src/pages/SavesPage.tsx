import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SavedTableDto, UserDto } from "digipology-protocol/http";

import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SiteHeader } from "../components/SiteHeader";
import { saveRoomSession } from "../utils/roomSession";

export function relativeSavedTime(createdAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SavesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [saves, setSaves] = useState<SavedTableDto[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [failedOperation, setFailedOperation] = useState<{ kind: "list" } | { kind: "resume" | "delete"; saveId: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (user === null) return;
    setListLoading(true); setError(null); setFailedOperation(null);
    const result = await api.listSaves();
    setListLoading(false);
    if (result.ok) setSaves(result.value.saves);
    else {
      setError(result.error.message);
      setFailedOperation({ kind: "list" });
    }
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  async function resume(saveId: string) {
    setPending(saveId); setError(null); setFailedOperation(null);
    const result = await api.resumeSave(saveId);
    setPending(null);
    if (!result.ok) {
      setFailedOperation({ kind: "resume", saveId });
      setError(result.error.code === "release_unavailable"
        ? "This game's release is no longer available"
        : result.error.message);
      return;
    }
    saveRoomSession(result.value);
    navigate(`/table/${result.value.roomId}`);
  }

  async function remove(saveId: string, confirmed = false) {
    if (!confirmed && !window.confirm("Delete this saved table?")) return;
    setDeleting(true); setPending(saveId); setError(null); setFailedOperation(null);
    const result = await api.deleteSave(saveId);
    setPending(null); setDeleting(false);
    if (result.ok) setSaves((current) => current.filter((save) => save.saveId !== saveId));
    else {
      setError(result.error.message);
      setFailedOperation({ kind: "delete", saveId });
    }
  }

  function retry() {
    if (failedOperation?.kind === "resume") void resume(failedOperation.saveId);
    else if (failedOperation?.kind === "delete") void remove(failedOperation.saveId, true);
    else void load();
  }

  return <div className="play-page"><SiteHeader /><SavesPageContent
    user={user}
    loading={loading || (user !== null && listLoading)}
    saves={saves}
    pending={pending}
    deleting={deleting}
    error={error}
    onSignIn={() => navigate("/login", { state: { backgroundLocation: location } })}
    onRetry={retry}
    onResume={(saveId) => void resume(saveId)}
    onDelete={(saveId) => void remove(saveId)}
  /></div>;
}

export function SavesPageContent({
  user,
  loading,
  saves,
  pending,
  deleting = false,
  error,
  onSignIn,
  onRetry,
  onResume,
  onDelete,
}: {
  user: UserDto | null;
  loading: boolean;
  saves: readonly SavedTableDto[];
  pending: string | null;
  deleting?: boolean;
  error: string | null;
  onSignIn(): void;
  onRetry(): void;
  onResume(saveId: string): void;
  onDelete(saveId: string): void;
}) {
  return <main className="saved-tables-page">
    <p className="eyebrow">Your account</p><h1>Saved tables</h1>
    {loading ? <p>Loading saved tables…</p> : user === null ? <section className="empty-state">
      <h2>Sign in to see saved tables</h2><p>Saved tables belong to your account.</p>
      <button type="button" onClick={onSignIn}>Sign in</button>
    </section> : error !== null ? <section role="alert"><p>{error}</p><button type="button" onClick={onRetry}>Retry</button></section>
      : saves.length === 0 ? <section className="empty-state"><h2>No saved tables yet</h2><p>Hosts can save a live table from its table menu.</p></section>
      : <div className="saved-tables-list">{saves.map((save) => <article key={save.saveId} className="saved-table-card">
        <div><strong>{save.label ?? save.gameTitle}</strong>{save.label === undefined ? null : <span>{save.gameTitle}</span>}
          <small>Saved {relativeSavedTime(save.createdAt)} · sequence {save.sequence} · {save.releaseId.slice(0, 18)}</small>
          {save.resumable === false ? <p className="saved-table-card__note">This save cannot be resumed by the current server.</p> : null}</div>
        <div><button type="button" disabled={pending !== null || save.resumable === false} onClick={() => onResume(save.saveId)}>
          {pending === save.saveId && !deleting ? "Resuming table" : "Resume"}</button>
          <button type="button" disabled={pending !== null} onClick={() => onDelete(save.saveId)}>{pending === save.saveId && deleting ? "Deleting table" : "Delete"}</button></div>
      </article>)}</div>}
  </main>;
}
