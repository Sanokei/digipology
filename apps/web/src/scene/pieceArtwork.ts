import type { EntityRecord } from "digipology-kernel";
import { playingCardIdentity, type PlayingCardIdentity } from "../components/playingCardIdentity";

/** Presentation data only. A hidden card never carries its definition into artwork. */
export type PieceArtwork =
  | { readonly kind: "card-back"; readonly count?: number; readonly enabled?: boolean; readonly gameTitle?: string }
  | { readonly kind: "standard-card"; readonly identity: PlayingCardIdentity }
  | { readonly kind: "custom-card"; readonly label: string; readonly accent: string }
  | { readonly kind: "die-face"; readonly value: number | string; readonly pips: boolean }
  | { readonly kind: "paper-edge"; readonly count: number }
  | { readonly kind: "counter-face"; readonly value: number; readonly color: string }
  | { readonly kind: "contact-shadow" }
  | { readonly kind: "felt" }
  | { readonly kind: "wood" };

export interface ArtworkDefinition { readonly label?: string; readonly color?: string }

export const CARD_PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  2: [[0, 0], [0, 4]], 3: [[0, 0], [0, 2], [0, 4]],
  4: [[-1, 0], [1, 0], [-1, 4], [1, 4]],
  5: [[-1, 0], [1, 0], [0, 2], [-1, 4], [1, 4]],
  6: [[-1, 0], [1, 0], [-1, 2], [1, 2], [-1, 4], [1, 4]],
  7: [[-1, 0], [1, 0], [0, 1], [-1, 2], [1, 2], [-1, 4], [1, 4]],
  8: [[-1, 0], [1, 0], [0, 1], [-1, 2], [1, 2], [0, 3], [-1, 4], [1, 4]],
  9: [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 2], [-1, 3], [1, 3], [-1, 4], [1, 4]],
  10: [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1.1], [0, 2.9], [-1, 3], [1, 3], [-1, 4], [1, 4]],
};

export const DIE_PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export function cardArtwork(entity: EntityRecord, definition?: ArtworkDefinition): PieceArtwork {
  const card = entity.components.card;
  const faceUp = entity.components.flippable?.flipped ?? card?.faceUp ?? false;
  if (!faceUp) return { kind: "card-back" };
  const label = definition?.label ?? "Card";
  const identity = playingCardIdentity(card?.definitionId, label);
  return identity === null
    ? { kind: "custom-card", label, accent: definition?.color ?? "#277267" }
    : { kind: "standard-card", identity };
}

/** Order is top, bottom, near, far, right, left; opposite standard faces sum to seven. */
export function dieArtworkFaces(entity: EntityRecord): readonly PieceArtwork[] {
  const die = entity.components.die;
  const value = die?.value ?? "?";
  const standardFaces = (die?.faces === undefined && die?.definitionId === "standard_d6") || (die?.faces !== undefined && die.faces.length === 6
    && [1, 2, 3, 4, 5, 6].every((face) => die.faces?.includes(face)));
  const standard = typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6 && standardFaces;
  const orientations: Readonly<Record<number, readonly number[]>> = {
    1: [1, 6, 2, 5, 3, 4], 2: [2, 5, 6, 1, 3, 4], 3: [3, 4, 2, 5, 6, 1],
    4: [4, 3, 2, 5, 1, 6], 5: [5, 2, 1, 6, 3, 4], 6: [6, 1, 5, 2, 3, 4],
  };
  if (standard) return orientations[value]!.map((face) => ({ kind: "die-face", value: face, pips: true }));
  // Custom dice keep their authored result. Do not invent a standard D6 identity.
  return Array.from({ length: 6 }, () => ({ kind: "die-face" as const, value, pips: false }));
}

export function artworkSize(artwork: PieceArtwork): readonly [number, number] {
  switch (artwork.kind) {
    case "card-back": case "standard-card": case "custom-card": return [512, 736];
    case "paper-edge": return [512, 128];
    case "felt": case "wood": return [1024, 1024];
    default: return [256, 256];
  }
}
