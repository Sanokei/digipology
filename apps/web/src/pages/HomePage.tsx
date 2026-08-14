import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { gameMetrics, type CatalogGameSummaryDto } from "../api/quickplayAdapter";
import type { PublicRoomDto } from "digipology-protocol/http";
import { GameHero } from "../components/GameHero";
import { GameRail } from "../components/GameRail";
import { HostDialog } from "../components/HostDialog";
import { SiteHeader } from "../components/SiteHeader";
import { useAuth } from "../auth/AuthContext";
import { isJoinCode, normalizeJoinCode } from "../utils/joinCode";
import { guestDisplayName, saveRoomSession, type SavedRoomSession } from "../utils/roomSession";
import { initialQuickPlayState, quickPlayReducer, type QuickPlayAction, type QuickPlayState } from "./quickPlayModel";

const METRICS_REFRESH_MS = 30_000;

export function relativeCreatedTime(createdAt: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [games, setGames] = useState<CatalogGameSummaryDto[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PublicRoomDto[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [hostingSlug, setHostingSlug] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flows, setFlows] = useState<Record<string, QuickPlayState>>({});
  const flowsRef = useRef<Record<string, QuickPlayState>>({});
  const toastTimer = useRef<number | null>(null);

  const loadGames = useCallback(async (initial = false) => {
    if (initial) setLoadingGames(true);
    const result = await api.listGames();
    if (result.ok) {
      setGames(result.value.games);
      setGamesError(null);
    } else if (initial) {
      setGamesError(result.error.message);
    }
    if (initial) setLoadingGames(false);
  }, []);

  useEffect(() => {
    void loadGames(true);
    let interval: number | null = null;
    const syncInterval = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
      if (document.visibilityState === "visible") {
        interval = window.setInterval(() => void loadGames(false), METRICS_REFRESH_MS);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadGames(false);
      syncInterval();
    };
    syncInterval();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [loadGames]);

  useEffect(() => {
    void api.listPublicRooms().then((result) => {
      if (result.ok) setRooms(result.value.rooms);
      else setRoomsError(result.error.message);
    });
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const featuredGames = useMemo(() => [...games].sort((left, right) => {
    const a = gameMetrics(left);
    const b = gameMetrics(right);
    return (b.currentPlayers - a.currentPlayers) || (b.totalPlays - a.totalPlays) || left.title.localeCompare(right.title);
  }), [games]);
  const mostPlayed = useMemo(() => [...games].sort((left, right) => gameMetrics(right).totalPlays - gameMetrics(left).totalPlays), [games]);
  const newest = useMemo(() => [...games].reverse(), [games]);
  const hero = featuredGames[0];
  const pendingSlugs = useMemo(() => new Set(
    Object.entries(flows).filter(([, flow]) => flow.phase === "pending").map(([slug]) => slug),
  ), [flows]);

  function dispatchFlow(slug: string, action: QuickPlayAction): QuickPlayState {
    const current = flowsRef.current[slug] ?? initialQuickPlayState;
    const next = quickPlayReducer(current, action);
    if (next === current) return current;
    flowsRef.current = { ...flowsRef.current, [slug]: next };
    setFlows(flowsRef.current);
    return next;
  }

  async function quickPlay(game: CatalogGameSummaryDto) {
    const pending = dispatchFlow(game.slug, { type: "activate" });
    if (pending.phase !== "pending") return;
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
    const displayName = user === null ? guestDisplayName() ?? undefined : undefined;
    const result = await api.quickPlay({ slug: game.slug, ...(displayName ? { displayName } : {}) });
    if (!result.ok) {
      const message = quickPlayError(result.error.code, result.error.message);
      dispatchFlow(game.slug, { type: "failed", message });
      setToast(message);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        setToast(null);
        dispatchFlow(game.slug, { type: "reset" });
      }, 4_500);
      return;
    }
    const session: SavedRoomSession = {
      ...result.value,
      inviteUrl: `https://play.digipology.com/join/${normalizeJoinCode(result.value.joinCode)}`,
      gameTitle: game.title,
    };
    const success = dispatchFlow(game.slug, { type: "succeeded", session });
    if (success.phase !== "success") return;
    saveRoomSession(success.session);
    navigate(success.navigateTo);
  }

  function signIn() {
    navigate("/login", { state: { backgroundLocation: location } });
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = normalizeJoinCode(joinCode);
    if (!isJoinCode(normalizedCode)) {
      setJoinError("Enter an eight-character invite code.");
      return;
    }
    navigate(`/join/${encodeURIComponent(normalizedCode)}`);
  }

  return (
    <div className="play-app">
      <SiteHeader />
      {loadingGames ? <CatalogSkeleton /> : games.length === 0 ? (
        <main className="play-catalog-state" role="status">
          <h1>{gamesError ? "The game shelf is warming up" : "No games are on the shelf yet"}</h1>
          <p>{gamesError ? "We couldn’t load the catalog just now. Try again in a moment." : "Published games will appear here as soon as they are ready."}</p>
          <button type="button" onClick={() => void loadGames(true)}>Retry</button>
        </main>
      ) : (
        <main className="play-catalog">
          {hero ? <GameHero game={hero} pending={pendingSlugs.has(hero.slug)} onQuickPlay={(game) => void quickPlay(game)} onHost={(game) => setHostingSlug(game.slug)} /> : null}
          <GameRail title="Featured" games={featuredGames} pendingSlugs={pendingSlugs} onQuickPlay={(game) => void quickPlay(game)} onHost={(game) => setHostingSlug(game.slug)} onDetails={(game) => navigate(`/games/${encodeURIComponent(game.slug)}`)} />
          <GameRail title="Most played" games={mostPlayed} pendingSlugs={pendingSlugs} onQuickPlay={(game) => void quickPlay(game)} onHost={(game) => setHostingSlug(game.slug)} onDetails={(game) => navigate(`/games/${encodeURIComponent(game.slug)}`)} />
          <GameRail title="New" games={newest} pendingSlugs={pendingSlugs} onQuickPlay={(game) => void quickPlay(game)} onHost={(game) => setHostingSlug(game.slug)} onDetails={(game) => navigate(`/games/${encodeURIComponent(game.slug)}`)} />
          <section className="play-room-hub" aria-label="Join or host a table">
            <div className="play-join-card">
              <p className="play-section-eyebrow">Have an invite?</p>
              <h2>Join by code</h2>
              <form onSubmit={handleJoin}>
                <label className="sr-only" htmlFor="join-code">Invite code or link</label>
                <input id="join-code" autoComplete="off" inputMode="text" maxLength={160} onChange={(event) => { setJoinCode(event.currentTarget.value); setJoinError(null); }} placeholder="ABCD-EFGH or invite link" value={joinCode} />
                <button type="submit">Join table</button>
              </form>
              {joinError ? <p className="play-inline-error" role="alert">{joinError}</p> : null}
            </div>
            <section className="play-public-rooms" aria-labelledby="public-rooms-title">
              <div className="play-public-rooms__heading">
                <div><p className="play-section-eyebrow">Open now</p><h2 id="public-rooms-title">Public rooms</h2></div>
                <button type="button" onClick={() => setHostingSlug("")}>Host a room</button>
              </div>
              {roomsError ? <p className="play-inline-error">Couldn’t load public rooms. {roomsError}</p> : null}
              {rooms.length === 0 && !roomsError ? <p className="play-empty-copy">No public tables are open yet. Host the first one.</p> : null}
              <div className="play-room-list">{rooms.map((room) => (
                <Link key={room.joinCode} to={`/join/${normalizeJoinCode(room.joinCode)}`} aria-label={`Join ${room.gameTitle}, ${room.players} of ${room.maxPlayers} seats filled`}>
                  <span><strong>{room.gameTitle}</strong><small>{relativeCreatedTime(room.createdAt)}</small></span>
                  <span>{room.players}/{room.maxPlayers}</span><i aria-hidden="true">→</i>
                </Link>
              ))}</div>
            </section>
          </section>
        </main>
      )}
      {toast ? <div className="play-toast" role="status">{toast}</div> : null}
      {hostingSlug !== null ? <HostDialog {...(hostingSlug ? { initialSlug: hostingSlug } : {})} onClose={() => setHostingSlug(null)} onSignIn={signIn} /> : null}
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <main className="play-catalog-skeleton" aria-busy="true" aria-label="Loading games">
      <div className="play-skeleton-hero" />
      {[0, 1, 2].map((row) => <section className="play-skeleton-rail" key={row} aria-hidden="true">
        <div className="play-skeleton-heading" />
        <div className="play-skeleton-track">{Array.from({ length: 8 }, (_, index) => <div className="play-skeleton-card" key={index} />)}</div>
      </section>)}
    </main>
  );
}

function quickPlayError(code: string, fallback: string): string {
  if (code === "game_not_found") return "That game is no longer available.";
  if (code === "rate_limited") return "Tables are filling quickly. Try again in a moment.";
  if (code === "quickplay_unavailable") return "Quick Play is warming up. You can still host a room.";
  return fallback || "Quick Play couldn’t find a table. Please try again.";
}
