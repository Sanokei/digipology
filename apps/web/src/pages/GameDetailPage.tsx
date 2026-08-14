import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GameResponse } from "digipology-protocol/http";
import { api } from "../api/client";
import { SiteHeader } from "../components/SiteHeader";

export function GameDetailPage() {
  const { slug = "" } = useParams();
  const [detail, setDetail] = useState<GameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.getGame(slug).then((result) => result.ok ? setDetail(result.value) : setError(result.error.message)); }, [slug]);
  return <div className="site-page"><SiteHeader /><main className="catalog-page">
    {error === null ? null : <p className="form-error">{error}</p>}
    {detail === null ? <p>Loading game…</p> : <section className="game-detail">
      <p className="eyebrow">{detail.game.builtin ? "Built-in game" : `Community release by ${detail.game.creatorHandle ?? "creator"}`}</p>
      <h1>{detail.game.title}</h1><p>{detail.game.tagline}</p>
      <dl><dt>Players</dt><dd>{detail.game.minPlayers}–{detail.game.maxPlayers}</dd><dt>Release</dt><dd>{detail.latestRelease.releaseNumber ?? 1}</dd><dt>Release ID</dt><dd><code>{detail.latestRelease.releaseId}</code></dd></dl>
      <Link className="button-link" to="/">Host from home</Link>
    </section>}
  </main></div>;
}

