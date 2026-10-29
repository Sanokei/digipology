import type { CardDesigns } from "digipology-protocol";
import { designedCard, entityCardBack } from "./cardDesigns";
import type { CardBackDefinition } from "./cardBack";
import type { EntityRecord } from "digipology-kernel";
import { cardArtwork, dieArtworkFaces, type PieceArtwork } from "./pieceArtwork";
import { CARD_STOCK, cardStockProfile, type CardPaperShape } from "./cardStock";

export type PieceShape = "box" | "cylinder" | "ring";

export interface PiecePresentation {
  readonly kind: "card" | "deck" | "die" | "chip" | "token";
  readonly shape: PieceShape;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly label: string;
  readonly color: string;
  readonly labelColor: string;
  readonly labelBackground: string;
  readonly specular: string;
  readonly emissive: string;
  readonly alpha: number;
  readonly billboardLabel: boolean;
}

export interface PieceDefinition {
  readonly label?: string;
  readonly color?: string;
}

/** Counters without a transform store rules data; they are not physical tokens. */
export function hasSpatialPresentation(entity: EntityRecord): boolean {
  const components = entity.components;
  return components.hand === undefined && (components.transform !== undefined
    || components.card !== undefined || components.deck !== undefined || components.die !== undefined);
}

const SEAT_COLORS = ["#f2a33a", "#42b8ef", "#e9e8df", "#b58cff"] as const;

function cardFaceUp(entity: EntityRecord): boolean {
  const { card, flippable } = entity.components;
  return flippable?.flipped ?? card?.faceUp ?? false;
}

export function seatColor(entityId: string): string {
  const match = /(?:^|_)seat_(\d+)(?:_|$)/.exec(entityId);
  const seat = match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
  return SEAT_COLORS[Math.max(0, seat - 1) % SEAT_COLORS.length] ?? "#d7b26d";
}

export function piecePresentation(
  entity: EntityRecord,
  definition?: PieceDefinition,
): PiecePresentation {
  const { components } = entity;
  const base = {
    kind: "token" as const,
    shape: "box" as const,
    width: 0.9,
    depth: 0.9,
    height: 0.18,
    label: "",
    color: "#d7b26d",
    labelColor: "#13211c",
    labelBackground: "#f2ecd9",
    specular: "#281d13",
    emissive: "#000000",
    alpha: 1,
    billboardLabel: false,
  };

  if (components.deck !== undefined) {
    const count = components.container?.items.length ?? 0;
    return {
      ...base,
      kind: "deck",
      width: 1.06,
      depth: 1.52,
      height: count === 0 ? 0.004 : CARD_STOCK.singleCardHeight + (Math.min(count, 52) - 1) * 0.006,
      label: `Deck · ${count}`,
      color: "#eee3c9",
      labelColor: "#fff5df",
      labelBackground: "#12584f",
    };
  }
  if (components.card !== undefined) {
    const faceUp = cardFaceUp(entity);
    return {
      ...base,
      kind: "card",
      width: 0.98,
      depth: 1.4,
      height: CARD_STOCK.singleCardHeight,
      label: faceUp ? definition?.label ?? "Card" : "Face-down card",
      color: "#f6edda",
      labelColor: faceUp ? "#17211d" : "#fff2d5",
      labelBackground: faceUp ? "#f3edda" : "#8d3429",
      specular: "#81765f",
    };
  }
  if (components.die !== undefined) {
    return {
      ...base,
      kind: "die",
      width: 0.8,
      depth: 0.8,
      height: 0.8,
      label: String(components.die.value),
      color: "#f2e9d6",
      labelBackground: "#f2e9d6",
      specular: "#b0a58c",
    };
  }
  if (components.counter !== undefined) {
    const color = seatColor(entity.id);
    return {
      ...base,
      kind: "chip",
      shape: "cylinder",
      width: 0.76,
      depth: 0.76,
      height: 0.18,
      label: String(components.counter.value),
      color,
      labelColor: "#111713",
      labelBackground: color,
      specular: "#5d4827",
      billboardLabel: false,
    };
  }
  if (components.zone !== undefined) {
    return {
      ...base,
      width: 1,
      depth: 1,
      height: 0.028,
      color: "#66c69c",
      specular: "#000000",
      emissive: "#12372b",
      alpha: components.zone.visibleInPlay ? 0.16 : 0,
    };
  }
  if (components["snap-point"] !== undefined) {
    const occupied = (components["snap-point"].attached?.length ?? 0) > 0;
    return {
      ...base,
      shape: "ring",
      width: 1.02,
      depth: 1.02,
      height: 0.08,
      color: occupied ? "#d5ff76" : "#203b31",
      specular: "#0a1511",
      emissive: occupied ? "#34441c" : "#07130f",
      alpha: 0.92,
    };
  }
  if (components.text !== undefined) {
    // The live status is rendered in the readable, responsive GameProgressPanel.
    // A second projected copy becomes tiny or clipped on narrow tables.
    if (entity.id === "status") return { ...base, alpha: 0 };
    return {
      ...base,
      width: 2.5,
      depth: 0.7,
      height: 0.07,
      label: components.text.value,
      color: "#14261f",
      labelColor: "#d9efdf",
      labelBackground: "#14261f",
      specular: "#07110e",
      emissive: "#091a14",
    };
  }
  if (components.button !== undefined) {
    return {
      ...base,
      width: 1.05,
      depth: 0.72,
      height: 0.2,
      label: components.button.label,
      color: components.button.enabled ? "#d5ff76" : "#625f58",
      labelBackground: components.button.enabled ? "#d5ff76" : "#625f58",
    };
  }
  if (components.tags?.values.includes("runner") === true || components.grabbable !== undefined) {
    const color = seatColor(entity.id);
    return {
      ...base,
      shape: "cylinder",
      width: 0.68,
      depth: 0.68,
      height: 0.24,
      color,
      specular: "#5b4325",
      emissive: "#0d1511",
    };
  }
  if (components.transform !== undefined) {
    return { ...base, label: "Table object" };
  }
  return base;
}

export function piecePresentationSignature(entity: EntityRecord, entities?: Readonly<Record<string, EntityRecord>>): string {
  const { card, counter, container, deck, die, button, text, zone } = entity.components;
  const snap = entity.components["snap-point"];
  if (deck !== undefined) return `deck:${deck.enabled}:${container?.items.length ?? 0}:${container?.items.at(-1) ?? ""}:${entities?.[container?.items.at(-1) ?? ""]?.components.card?.definitionId ?? ""}`;
  if (card !== undefined) return `card:${card.definitionId}:${cardFaceUp(entity)}`;
  if (die !== undefined) return `die:${die.definitionId}:${String(die.value)}:${JSON.stringify(die.faces ?? null)}`;
  if (counter !== undefined) return `counter:${counter.value}`;
  if (snap !== undefined) return `snap:${snap.attached?.length ?? 0}`;
  if (zone !== undefined) return `zone:${zone.visibleInPlay}`;
  if (button !== undefined) return `button:${button.enabled}:${button.label}`;
  if (text !== undefined) return `text:${text.value}`;
  return "other";
}

export interface PieceSurface {
  readonly name: string;
  readonly artwork: PieceArtwork;
  readonly width: number;
  readonly height: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly paperShape?: CardPaperShape;
}

/** Decorative surfaces never replace the entity's pickable mesh. */
export function pieceSurfaceLayout(entity: EntityRecord, appearance: PiecePresentation, definition?: PieceDefinition, presentation?: { designs: CardDesigns | null; entities: Readonly<Record<string, EntityRecord>>; back: CardBackDefinition }): readonly PieceSurface[] {
  const { width, depth, height, kind } = appearance;
  const y = height / 2 + 0.002;
  if (kind === "card" || kind === "deck") {
    const stock = cardStockProfile(width, height, depth);
    const paperY = height / 2 + CARD_STOCK.surfaceLift;
    const count = entity.components.container?.items.length ?? 0;
    const back = presentation ? entityCardBack(presentation.designs, entity, presentation.entities, presentation.back) : undefined;
    const top: PieceArtwork = kind === "deck"
      ? { kind: "card-back", count, enabled: entity.components.deck?.enabled ?? false, ...(back ? { back, gameTitle: back.title } : {}) }
      : (() => { const artwork = cardArtwork(entity, definition, designedCard(presentation?.designs ?? null, entity.components.card?.definitionId)); return artwork.kind === "card-back" && back ? { ...artwork, back, gameTitle: back.title } : artwork; })();
    const surfaces: PieceSurface[] = [
      { name: "face", artwork: top, width: stock.faceWidth, height: stock.faceDepth, paperShape: stock.paperShape, position: [0, paperY, 0], rotation: [Math.PI / 2, 0, 0] },
      { name: "reverse", artwork: { kind: "card-back", ...(back ? { back, gameTitle: back.title } : {}) }, width: stock.faceWidth, height: stock.faceDepth, paperShape: stock.paperShape, position: [0, -paperY, 0], rotation: [-Math.PI / 2, 0, 0] },
    ];
    if (kind === "deck" && count > 1) {
      const artwork: PieceArtwork = { kind: "paper-edge", count };
      const h = stock.edgeHeight;
      surfaces.push(
        { name: "paper-near", artwork, width: stock.edgeWidth, height: h, position: [0, 0, -depth / 2 - CARD_STOCK.surfaceLift], rotation: [0, 0, 0] },
        { name: "paper-far", artwork, width: stock.edgeWidth, height: h, position: [0, 0, depth / 2 + CARD_STOCK.surfaceLift], rotation: [0, Math.PI, 0] },
        { name: "paper-right", artwork, width: stock.edgeDepth, height: h, position: [width / 2 + CARD_STOCK.surfaceLift, 0, 0], rotation: [0, -Math.PI / 2, 0] },
        { name: "paper-left", artwork, width: stock.edgeDepth, height: h, position: [-width / 2 - CARD_STOCK.surfaceLift, 0, 0], rotation: [0, Math.PI / 2, 0] },
      );
    }
    return surfaces;
  }
  if (kind === "die") {
    const face = width * 0.76;
    return dieArtworkFaces(entity).map((artwork, index) => ({
      name: `pip-${index}`, artwork, width: face, height: face,
      position: ([ [0, y, 0], [0, -y, 0], [0, 0, -depth / 2 - 0.002], [0, 0, depth / 2 + 0.002], [width / 2 + 0.002, 0, 0], [-width / 2 - 0.002, 0, 0] ] as const)[index]!,
      rotation: ([ [Math.PI / 2, 0, 0], [-Math.PI / 2, 0, 0], [0, 0, 0], [0, Math.PI, 0], [0, -Math.PI / 2, 0], [0, Math.PI / 2, 0] ] as const)[index]!,
    }));
  }
  if (kind === "chip" && entity.components.counter !== undefined) {
    return [{ name: "score", artwork: { kind: "counter-face", value: entity.components.counter.value, color: appearance.color }, width: width * 0.995, height: depth * 0.995, position: [0, y, 0], rotation: [Math.PI / 2, 0, 0] }];
  }
  return [];
}
