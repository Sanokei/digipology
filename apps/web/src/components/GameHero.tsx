import { useEffect, useState } from "react";

import { Link } from "react-router-dom";
import { ArrowUpRight, Play } from "lucide-react";
import { gameMetrics, type CatalogGameSummaryDto } from "../api/quickplayAdapter";
import { formatCompactCount } from "../utils/compactCount";
import { coverPlaceholder } from "../utils/coverPlaceholder";
import { gameArtwork } from "../utils/gameArtwork";

interface GameHeroProps {
  game: CatalogGameSummaryDto;
  pending: boolean;
  onQuickPlay(game: CatalogGameSummaryDto): void;
  onHost(game: CatalogGameSummaryDto): void;
}

export function GameHero({ game, pending, onQuickPlay, onHost }: GameHeroProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = gameArtwork(game);
  const metrics = gameMetrics(game);
  const placeholder = coverPlaceholder(game.slug);
  useEffect(() => setCoverFailed(false), [coverUrl]);

  return (
    <section className="game-hero" aria-label={`Featured game: ${game.title}`}>
      <div className="game-hero__art" aria-hidden="true">
        <img src="/art/tabletop-world.webp" alt="" fetchPriority="high" draggable={false} />
      </div>
      <div className="game-hero__scrim" aria-hidden="true" />
      <div className="game-hero__body">
        <p className="game-hero__eyebrow"><span aria-hidden="true" />The table is open</p>
        <h1>Board games.<br /><em>Better together.</em></h1>
        <p className="game-hero__description">A quick round, an epic rivalry, or a game of your own. Pull up a chair and play right in your browser.</p>
        <div className="game-hero__actions">
          <button type="button" className="game-hero__cta" aria-busy={pending} onClick={() => { if (!pending) onQuickPlay(game); }}>
            <Play size={12} fill="currentColor" aria-hidden="true" />{pending ? "Finding a table…" : "Quick Play"}
          </button>
          <button type="button" className="game-hero__host" onClick={() => onHost(game)}>Host a Room</button>
        </div>
        <p className="game-hero__footnote">No downloads. Just one more round.</p>
      </div>
      <div className="game-hero__pick">
        <div className="game-hero__pick-art" style={{ background: placeholder.background }}>
          {coverUrl && !coverFailed ? <img src={coverUrl} alt="" onError={() => setCoverFailed(true)} draggable={false} /> : null}
        </div>
        <div><span className="game-hero__pick-label">Tonight’s pick</span><strong>{game.title}</strong><span>{game.minPlayers}–{game.maxPlayers} players{metrics.currentPlayers > 0 ? ` · ${formatCompactCount(metrics.currentPlayers)} playing` : ""}</span></div>
        <ArrowUpRight className="game-hero__pick-arrow" size={22} aria-hidden="true" />
      </div>
      <Link className="game-hero__create" to="/create">Feeling creative? Make a game <ArrowUpRight size={13} aria-hidden="true" /></Link>
    </section>
  );
}
