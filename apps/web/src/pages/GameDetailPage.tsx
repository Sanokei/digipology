import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { GameResponse } from "digipology-protocol/http";
import { api } from "../api/client";
import { gameCoverUrl } from "../api/quickplayAdapter";
import { SiteHeader } from "../components/SiteHeader";
import { HostDialog } from "../components/HostDialog";
import type { RasterArtworkInfo } from "digipology-protocol";
import { artworkBlob, artworkPackage, downloadBlob, fetchPublishedArtwork } from "../editor/state/artwork";
import "../components/artwork.css";
import "./gameDetail.css";

export function GameDetailPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [hosting, setHosting] = useState(false);
  const [detail, setDetail] = useState<GameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artwork, setArtwork] = useState<RasterArtworkInfo | null>(null);
  const [artError, setArtError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setError(null); setDetail(null); setArtwork(null); setArtError(null); setImageFailed(false);
    void api.getGame(slug).then((result) => { if (active) { if (result.ok) setDetail(result.value); else setError(result.error.message); } });
    return () => { active = false; };
  }, [slug, retry]);
  useEffect(() => {
    if (!detail || detail.game.coverVersion === null || detail.game.builtin) return;
    let active = true;
    void api.getCoverInfo(slug, detail.game.coverVersion).then((result) => {
      if (!active) return;
      if (result.ok) setArtwork(result.value.artwork);
      else setArtError("Artwork information could not load. Retry to see credits and save the image.");
    });
    return () => { active = false; };
  }, [detail, slug]);
  const cover = detail === null ? null : gameCoverUrl(detail.game);
  async function saveArtwork(withCredits: boolean) {
    if (!artwork || !cover) return;
    setSaving(true); setArtError(null);
    try {
      const ready = await fetchPublishedArtwork(cover, artwork);
      const extension = artwork.contentType === "image/jpeg" ? "jpg" : artwork.contentType.replace("image/", "");
      downloadBlob(withCredits ? new Blob([artworkPackage(ready)], { type: "application/json" }) : artworkBlob(ready), `${slug}.${withCredits ? "artwork.json" : extension}`);
    } catch (caught) { setArtError(caught instanceof Error ? caught.message : "The image could not be saved. Retry loading the artwork."); }
    finally { setSaving(false); }
  }
  return <div className="site-page"><SiteHeader /><main className="catalog-page game-detail-page">
    <Link className="game-detail__back" to="/games">← All games</Link>
    {error === null ? null : <section className="catalog-message" role="alert"><h1>Game unavailable</h1><p>{error}</p><Link className="button-link" to="/games">Browse games</Link></section>}
    {detail === null && error === null ? <div className="game-detail game-detail--loading" aria-label="Loading game"><div /><section><span /><span /><span /></section></div> : null}
    {detail === null ? null : <section className="game-detail game-detail--entry">
      <div className="game-detail__copy">
        <p className="eyebrow">{detail.game.builtin ? "Digipology original" : `Community release by ${detail.game.creatorHandle ?? "creator"}`}</p>
        <h1>{detail.game.title}</h1>
        <p className="game-detail__players">{detail.game.minPlayers}–{detail.game.maxPlayers} players</p>
        <div className="game-detail__actions"><button className="button-link" type="button" onClick={() => setHosting(true)}>Play or host</button><Link className="text-link" to="/games">Keep browsing</Link></div>
        <p className="game-detail__description">{detail.game.tagline}</p>
        <dl><dt>Playing now</dt><dd>{detail.game.currentPlayers}</dd><dt>Total plays</dt><dd>{detail.game.totalPlays}</dd><dt>Release</dt><dd>{detail.latestRelease.releaseNumber ?? 1}</dd></dl>
      </div>
      <div className="game-detail__artwork">
        <div className="game-detail__cover">{cover && !imageFailed ? <img alt={`${detail.game.title} cover`} src={`${cover}&retry=${retry}`} onError={() => setImageFailed(true)} /> : <span aria-hidden="true">{detail.game.title.slice(0, 1)}</span>}</div>
        {cover ? <a className="game-detail__original text-link" href={cover} target="_blank" rel="noopener noreferrer">View full artwork</a> : null}
        {imageFailed ? <p role="alert">The artwork could not load. Your game is still available.</p> : null}
        {artwork && (artwork.credits.artist || artwork.credits.license || artwork.credits.sourceUrl) ? <p className="artwork-credit" aria-label="Artwork credits">{artwork.credits.artist ? <span>Artwork: {artwork.credits.artist}</span> : null}{artwork.credits.license ? <span>{artwork.credits.license}</span> : null}{artwork.credits.sourceUrl ? <a href={artwork.credits.sourceUrl} target="_blank" rel="noopener noreferrer">Source page ↗</a> : null}</p> : null}
        {artwork ? <div className="artwork-downloads"><button type="button" disabled={saving} onClick={() => void saveArtwork(false)}>Save image</button><button type="button" disabled={saving} onClick={() => void saveArtwork(true)}>Save with credits</button></div> : null}
        {artError ? <p role="alert">{artError}</p> : null}
        {imageFailed || artError ? <button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry artwork</button> : null}
      </div>
    </section>}
  </main>{hosting && detail ? <HostDialog key={detail.game.slug} initialGame={detail.game} onClose={() => setHosting(false)} onSignIn={() => navigate("/login", { state: { backgroundLocation: location } })} /> : null}</div>;
}
