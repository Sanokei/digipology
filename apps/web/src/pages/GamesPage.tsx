import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GameSummaryDto } from "digipology-protocol/http";
import { api } from "../api/client";
import { SiteHeader } from "../components/SiteHeader";

export function GamesPage() {
  const [games, setGames] = useState<GameSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.listGames().then((result) => result.ok ? setGames(result.value.games) : setError(result.error.message)); }, []);
  return <div className="site-page"><SiteHeader /><main className="catalog-page">
    <header><p className="eyebrow">Game library</p><h1>Browse games</h1><p>Built-in tables and public community releases, ready to host.</p></header>
    {error === null ? null : <p className="form-error">{error}</p>}
    <div className="game-grid">{games.map((game) => <Link className="game-card" key={game.slug} to={`/games/${encodeURIComponent(game.slug)}`}>
      <span>{game.builtin ? "Built in" : `by ${game.creatorHandle ?? "community creator"}`}</span><h2>{game.title}</h2><p>{game.tagline}</p><small>{game.minPlayers}–{game.maxPlayers} players</small>
    </Link>)}</div>
  </main></div>;
}
