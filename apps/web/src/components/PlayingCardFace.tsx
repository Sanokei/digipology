import "./playingCard.css";
import type { PlayingCardIdentity } from "./playingCardIdentity";
export type { PlayingCardIdentity } from "./playingCardIdentity";

const SUITS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;

const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  2: [[2, 1], [2, 5]], 3: [[2, 1], [2, 3], [2, 5]],
  4: [[1, 1], [3, 1], [1, 5], [3, 5]], 5: [[1, 1], [3, 1], [2, 3], [1, 5], [3, 5]],
  6: [[1, 1], [3, 1], [1, 3], [3, 3], [1, 5], [3, 5]],
  7: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [1, 5], [3, 5]],
  8: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [2, 4], [1, 5], [3, 5]],
  9: [[1, 1], [3, 1], [1, 2], [3, 2], [2, 3], [1, 4], [3, 4], [1, 5], [3, 5]],
  10: [[1, 1], [3, 1], [1, 2], [3, 2], [2, 2], [2, 4], [1, 4], [3, 4], [1, 5], [3, 5]],
};

export function PlayingCardFace({ identity, compact = false }: { identity: PlayingCardIdentity; compact?: boolean }) {
  const symbol = SUITS[identity.suit];
  const red = identity.suit === "hearts" || identity.suit === "diamonds";
  const pips = compact ? undefined : PIPS[Number(identity.rank)];
  return <span className={`playing-card${red ? " playing-card--red" : ""}${compact ? " playing-card--compact" : ""}`} aria-hidden="true">
    <span className="playing-card__corner"><b>{identity.rank}</b><span>{symbol}</span></span>
    {pips ? <span className="playing-card__pips">{pips.map(([column, row], index) => <span key={index} style={{ gridColumn: column, gridRow: row }}>{symbol}</span>)}</span>
      : <span className={`playing-card__center${identity.rank === "A" || compact ? "" : " playing-card__center--court"}`}>{identity.rank === "A" || compact ? symbol : <><b>{identity.rank}</b><span>{symbol}</span></>}</span>}
    <span className="playing-card__corner playing-card__corner--bottom"><b>{identity.rank}</b><span>{symbol}</span></span>
  </span>;
}
