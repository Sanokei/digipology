export const STANDARD_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const STANDARD_RANKS = ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"] as const;

export interface AuthoredCard {
  readonly id: string;
  readonly definitionId: string;
  readonly suit: typeof STANDARD_SUITS[number];
  readonly rank: typeof STANDARD_RANKS[number];
}

export function standard52CardDeck(prefix = "card"): AuthoredCard[] {
  return STANDARD_SUITS.flatMap((suit) => STANDARD_RANKS.map((rank) => ({
    id: `${prefix}_${suit}_${rank}`,
    definitionId: `standard_${suit}_${rank}`,
    suit,
    rank,
  })));
}
