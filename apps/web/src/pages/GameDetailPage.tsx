import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GameResponse } from "digipology-protocol/http";
import { api } from "../api/client";
import { gameCoverUrl } from "../api/quickplayAdapter";
import { SiteHeader } from "../components/SiteHeader";

export function GameDetailPage() {
  const { slug = "" } = useParams();
  const [detail, setDetail] = useState<GameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.getGame(slug).then((result) => result.ok ? setDetail(result.value) : setError(result.error.message)); }, [slug]);
  const cover = detail === null ? null : gameCoverUrl(detail.game);
  return <div className="site-page"><SiteHeader /><main className="catalog-page game-detail-page">
    <Link className="game-detail__back" to="/games">← All games</Link>
    {error === null ? null : <section className="catalog-message" role="alert"><h1>Game unavailable</h1><p>{error}</p><Link className="button-link" to="/games">Browse games</Link></section>}
    {detail === null && error === null ? <div className="game-detail game-detail--loading" aria-label="Loading game"><div /><section><span /><span /><span /></section></div> : null}
    {detail === null ? null : <section className="game-detail">
      <div className="game-detail__cover">{cover ? <img alt={`${detail.game.title} cover`} src={cover} /> : <span aria-hidden="true">{detail.game.title.slice(0, 1)}</span>}</div>
      <div className="game-detail__copy">
        <p className="eyebrow">{detail.game.builtin ? "Digipology original" : `Community release by ${detail.game.creatorHandle ?? "creator"}`}</p>
        <h1>{detail.game.title}</h1><p>{detail.game.tagline}</p>
        <dl><dt>Players</dt><dd>{detail.game.minPlayers}–{detail.game.maxPlayers}</dd><dt>Playing now</dt><dd>{detail.game.currentPlayers}</dd><dt>Total plays</dt><dd>{detail.game.totalPlays}</dd><dt>Release</dt><dd>{detail.latestRelease.releaseNumber ?? 1}</dd></dl>
        <div className="game-detail__actions"><Link className="button-link" to="/">Play or host</Link><Link className="text-link" to="/games">Keep browsing</Link></div>
      </div>
    </section>}
  </main></div>;
}
