import { useEffect, useState } from "react";

import { gameCoverUrl, gameMetrics, type CatalogGameSummaryDto } from "../api/quickplayAdapter";
import { formatCompactCount } from "../utils/compactCount";
import { coverPlaceholder } from "../utils/coverPlaceholder";

interface GameHeroProps {
  game: CatalogGameSummaryDto;
  pending: boolean;
  onQuickPlay(game: CatalogGameSummaryDto): void;
  onHost(game: CatalogGameSummaryDto): void;
}

export function GameHero({ game, pending, onQuickPlay, onHost }: GameHeroProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = gameCoverUrl(game);
  const metrics = gameMetrics(game);
  const placeholder = coverPlaceholder(game.slug);
  useEffect(() => setCoverFailed(false), [coverUrl]);

  return (
    <section className="game-hero" aria-label={`Featured game: ${game.title}`}>
      <div className="game-hero__art" style={coverUrl && !coverFailed ? undefined : { background: placeholder.background }} aria-hidden="true">
        {coverUrl && !coverFailed ? <img src={coverUrl} alt="" onError={() => setCoverFailed(true)} draggable={false} /> : null}
      </div>
      <div className="game-hero__scrim" aria-hidden="true" />
      <div className="game-hero__body">
        <p className="game-hero__eyebrow">Featured table</p>
        <h1>{game.title}</h1>
        <p className="game-hero__description">{game.tagline || `A browser-native tabletop game for ${game.minPlayers}–${game.maxPlayers} players.`}</p>
        <p className="game-hero__metrics">
          {metrics.currentPlayers > 0 ? <span><i aria-hidden="true" />{formatCompactCount(metrics.currentPlayers)} playing</span> : null}
          <span>{formatCompactCount(metrics.totalPlays)} plays</span>
        </p>
        <div className="game-hero__actions">
          <button type="button" className="game-hero__cta" aria-busy={pending} onClick={() => { if (!pending) onQuickPlay(game); }}>
            {pending ? "Finding a table…" : "Quick Play"}
          </button>
          <button type="button" className="game-hero__host" onClick={() => onHost(game)}>Host a Room</button>
        </div>
      </div>
    </section>
  );
}
