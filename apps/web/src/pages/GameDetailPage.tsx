import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { GameResponse } from "digipology-protocol/http";
import { api } from "../api/client";
import { gameCoverUrl } from "../api/quickplayAdapter";
import { SiteHeader } from "../components/SiteHeader";
import { HostDialog } from "../components/HostDialog";
import { useAuth } from "../auth/AuthContext";
import { guestDisplayName, saveRoomSession } from "../utils/roomSession";
import { normalizeJoinCode } from "../utils/joinCode";

export function GameDetailPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [detail, setDetail] = useState<GameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { void api.getGame(slug).then((result) => result.ok ? setDetail(result.value) : setError(result.error.message)); }, [slug]);
  const cover = detail === null ? null : gameCoverUrl(detail.game);
  async function quickPlay() {
    if (detail === null || playing) return;
    setPlaying(true); setError(null);
    const guest = user === null ? guestDisplayName() : null;
    const result = await api.quickPlay({ slug, ...(guest ? { displayName: guest } : {}) });
    setPlaying(false);
    if (!result.ok) { setError(result.error.message); return; }
    const session = { ...result.value, inviteUrl: `https://play.digipology.com/join/${normalizeJoinCode(result.value.joinCode)}`, gameTitle: detail.game.title, gameSlug: detail.game.slug };
    saveRoomSession(session); navigate(`/table/${encodeURIComponent(session.roomId)}`);
  }
  return <div className="site-page"><SiteHeader /><main className="catalog-page game-detail-page">
    <Link className="game-detail__back" to="/games">← All games</Link>
    {error === null ? null : <section className="catalog-message" role="alert"><h1>Game unavailable</h1><p>{error}</p><Link className="button-link" to="/games">Browse games</Link></section>}
    {detail === null && error === null ? <div className="game-detail game-detail--loading" aria-label="Loading game"><div /><section><span /><span /><span /></section></div> : null}
    {detail === null ? null : <section className="game-detail">
      <div className="game-detail__cover">{cover ? <img alt={`${detail.game.title} cover`} src={cover} /> : <span aria-hidden="true">{detail.game.title.slice(0, 1)}</span>}</div>
      <div className="game-detail__copy">
        <p className="eyebrow">{detail.game.builtin ? "Digipology original" : `Community release by ${detail.game.creatorHandle ?? "creator"}`}</p>
        <h1>{detail.game.title}</h1><p>{detail.game.description ?? detail.game.tagline}</p>
        <ul className="game-detail__tags" aria-label="Game metadata"><li>{detail.game.minPlayers}–{detail.game.maxPlayers} players</li>{detail.game.playTimeMinutes === undefined ? null : <li>{detail.game.playTimeMinutes} min</li>}{detail.game.tags?.map((tag) => <li key={tag}>{tag}</li>)}</ul>
        <dl>
          <dt>Players</dt><dd>{detail.game.minPlayers}–{detail.game.maxPlayers}</dd>
          {detail.game.playTimeMinutes === undefined ? null : <><dt>Play time</dt><dd>{detail.game.playTimeMinutes} min</dd></>}
          {detail.game.complexity === undefined ? null : <><dt>Complexity</dt><dd>{detail.game.complexity}/5</dd></>}
          <dt>Playing now</dt><dd>{detail.game.currentPlayers}</dd>
          <dt>Total plays</dt><dd>{detail.game.totalPlays}</dd>
          <dt>Release</dt><dd>{detail.latestRelease.releaseNumber ?? 1}</dd>
        </dl>
        <div className="game-detail__actions"><button className="button-link" type="button" disabled={playing} onClick={() => void quickPlay()}>{playing ? "Finding a table…" : "Quick play"}</button><button className="secondary-button" type="button" onClick={() => setHosting(true)}>Host this game</button><Link className="text-link" to="/games">Keep browsing</Link></div>
      </div>
    </section>}
    {hosting ? <HostDialog initialSlug={slug} onClose={() => setHosting(false)} onSignIn={() => navigate("/login", { state: { backgroundLocation: location } })} /> : null}
  </main></div>;
}
