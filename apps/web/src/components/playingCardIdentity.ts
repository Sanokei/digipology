export interface PlayingCardIdentity {
  rank: string;
  suit: "clubs" | "diamonds" | "hearts" | "spades";
}

const RANK_NAMES: Record<string, string> = { A: "Ace", J: "Jack", Q: "Queen", K: "King" };

/** Only the explicitly authored v2 deck has this identity convention. */
export function playingCardIdentity(definitionId: string | undefined, label: string): PlayingCardIdentity | null {
  const match = /^standard_v2_(clubs|diamonds|hearts|spades)_(a|[2-9]|10|j|q|k)$/.exec(definitionId ?? "");
  if (!match) return null;
  const suit = match[1] as PlayingCardIdentity["suit"];
  const rank = match[2]!.toUpperCase();
  const expected = `${RANK_NAMES[rank] ?? rank} of ${suit[0]!.toUpperCase()}${suit.slice(1)}`;
  // A custom label retains its own presentation even when an ID is reused.
  return label === expected ? { rank, suit } : null;
}
