import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GameSummaryDto } from "digipology-protocol/http";
import { api } from "../api/client";
import { gameCoverUrl } from "../api/quickplayAdapter";
import { SiteHeader } from "../components/SiteHeader";

export function GamesPage() {
  const [games, setGames] = useState<GameSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.listGames();
    if (result.ok) {
      setGames(result.value.games);
      setError(null);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="site-page"><SiteHeader /><main className="catalog-page">
    <header><p className="eyebrow">Game library</p><h1>Browse games</h1><p>Built-in tables and public community releases, ready to host.</p></header>
    {loading ? <div className="game-grid game-grid--loading" aria-label="Loading games">{Array.from({ length: 6 }, (_, index) => <div className="game-card game-card--skeleton" key={index} />)}</div> : null}
    {!loading && error !== null ? <section className="catalog-message" role="alert"><h2>The shelf didn’t load</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Try again</button></section> : null}
    {!loading && error === null && games.length === 0 ? <section className="catalog-message"><h2>No published games yet</h2><p>The first public release will appear here automatically.</p><Link className="button-link" to="/create">Create a game</Link></section> : null}
    {!loading && error === null ? <div className="game-grid">{games.map((game) => {
      const cover = gameCoverUrl(game);
      return <Link className="game-card" key={game.slug} to={`/games/${encodeURIComponent(game.slug)}`}>
        <div className="game-card__cover">{cover ? <img alt="" src={cover} /> : <span aria-hidden="true">{game.title.slice(0, 1)}</span>}</div>
        <div className="game-card__copy"><span>{game.builtin ? "Digipology original" : `by ${game.creatorHandle ?? "community creator"}`}</span><h2>{game.title}</h2><p>{game.tagline}</p><small>{game.minPlayers}–{game.maxPlayers} players · {game.currentPlayers} playing now</small></div>
      </Link>;
    })}</div> : null}
  </main></div>;
}
