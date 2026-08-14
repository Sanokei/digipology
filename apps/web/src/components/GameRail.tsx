import { useRef } from "react";

import type { CatalogGameSummaryDto } from "../api/quickplayAdapter";
import { GameCapsule } from "./GameCapsule";

interface GameRailProps {
  title: string;
  games: CatalogGameSummaryDto[];
  pendingSlugs: ReadonlySet<string>;
  onQuickPlay(game: CatalogGameSummaryDto): void;
  onHost(game: CatalogGameSummaryDto): void;
  onDetails(game: CatalogGameSummaryDto): void;
}

export function GameRail({ title, games, pendingSlugs, onQuickPlay, onHost, onDetails }: GameRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  function page(direction: -1 | 1) {
    const track = trackRef.current;
    if (track === null) return;
    track.scrollBy({ left: direction * Math.round(track.clientWidth * 0.85), behavior: "smooth" });
  }

  if (games.length === 0) return null;
  return (
    <section className="game-rail" aria-labelledby={`rail-${slugify(title)}`}>
      <h2 id={`rail-${slugify(title)}`}>{title}</h2>
      <div className="game-rail__viewport">
        <button type="button" className="game-rail__nav game-rail__nav--prev" aria-label={`Scroll ${title} left`} onClick={() => page(-1)}>‹</button>
        <div className="game-rail__track" ref={trackRef}>
          {games.map((game) => (
            <GameCapsule
              key={game.slug}
              game={game}
              pending={pendingSlugs.has(game.slug)}
              onQuickPlay={onQuickPlay}
              onHost={onHost}
              onDetails={onDetails}
            />
          ))}
        </div>
        <button type="button" className="game-rail__nav game-rail__nav--next" aria-label={`Scroll ${title} right`} onClick={() => page(1)}>›</button>
      </div>
    </section>
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}
