import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { GameSummaryDto } from "digipology-protocol/http";
import { useAuth } from "../auth/AuthContext";
import { guestDisplayName, saveGuestDisplayName, saveRoomSession } from "../utils/roomSession";
import type { SavedRoomSession } from "../utils/roomSession";

export function publicHostingAllowed(signedIn: boolean, visibility: "private" | "public"): boolean {
  return visibility === "private" || signedIn;
}

interface HostDialogProps {
  initialSlug?: string;
  onClose(): void;
  onSignIn(): void;
}

export function HostDialog({ initialSlug, onClose, onSignIn }: HostDialogProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [games, setGames] = useState<GameSummaryDto[]>([]);
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [name, setName] = useState(() => guestDisplayName() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SavedRoomSession | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.listGames().then((result) => {
      if (result.ok) {
        setGames(result.value.games);
        setSlug((current) => current || initialSlug || result.value.games[0]?.slug || "");
      }
      else setError(result.error.message);
    });
  }, [initialSlug]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!publicHostingAllowed(user !== null, visibility)) { onSignIn(); return; }
    setBusy(true); setError(null);
    const displayName = user === null ? name.trim() : undefined;
    const [room, game] = await Promise.all([
      api.createRoom({ releaseSlugOrId: slug, visibility, ...(displayName ? { displayName } : {}) }),
      api.getGame(slug),
    ]);
    setBusy(false);
    if (!room.ok) { setError(room.error.message); return; }
    if (!game.ok) { setError(game.error.message); return; }
    if (displayName) saveGuestDisplayName(displayName);
    const saved: SavedRoomSession = {
      ...room.value,
      releaseId: game.value.latestRelease.releaseId,
      gameTitle: game.value.game.title,
    };
    saveRoomSession(saved);
    setCreated(saved);
  }

  async function copyInvite(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("Copy isn’t available here. Select the invite URL and copy it manually."); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="host-title">
        <button className="modal__close" type="button" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">New table</p><h2 id="host-title">{created === null ? "Host a game" : "Your table is ready"}</h2>
        {created === null ? <form className="stack-form" onSubmit={(event) => void create(event)}>
          <label htmlFor="game">Game</label>
          <select id="game" required value={slug} onChange={(event) => setSlug(event.currentTarget.value)}>
            {games.map((game) => <option key={game.slug} value={game.slug}>{game.title}{game.creatorHandle === undefined ? "" : ` by ${game.creatorHandle}`} — {game.minPlayers}–{game.maxPlayers} players</option>)}
          </select>
          {user === null ? <><label htmlFor="host-name">Display name</label><input id="host-name" required maxLength={64} value={name} onChange={(event) => setName(event.currentTarget.value)} /></> : null}
          <fieldset className="segmented"><legend>Visibility</legend>
            <label><input type="radio" name="visibility" checked={visibility === "private"} onChange={() => setVisibility("private")} /> Private</label>
            <label><input type="radio" name="visibility" checked={visibility === "public"} onChange={() => setVisibility("public")} /> Public</label>
          </fieldset>
          {publicHostingAllowed(user !== null, visibility) ? null : <p className="form-notice">Public rooms require an account. <button className="text-button" type="button" onClick={onSignIn}>Sign in to continue</button>.</p>}
          {error === null ? null : <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy || slug === ""}>{busy ? "Opening table…" : "Create table"}</button>
        </form> : <div className="invite-ready"><p>Share this invite, then enter when you’re ready.</p><label htmlFor="invite-url">Invite URL</label><div className="copy-field"><input id="invite-url" readOnly value={created.inviteUrl} /><button type="button" onClick={() => void copyInvite(created.inviteUrl)}>{copied ? "Copied" : "Copy"}</button></div>{error === null ? null : <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="button" onClick={() => navigate(`/table/${encodeURIComponent(created.roomId)}`)}>Enter table</button></div>}
      </section>
    </div>
  );
}
