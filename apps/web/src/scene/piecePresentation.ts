import type { EntityRecord } from "digipology-kernel";

export type PieceShape = "box" | "cylinder" | "ring";

export interface PiecePresentation {
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
    return {
      ...base,
      width: 1.02,
      depth: 1.42,
      height: 0.14 + Math.min(components.container?.items.length ?? 0, 20) * 0.012,
      label: `Deck · ${components.container?.items.length ?? 0}`,
      color: components.deck.enabled ? "#6f382b" : "#46413d",
      labelColor: "#fff5df",
      labelBackground: "#6f382b",
    };
  }
  if (components.card !== undefined) {
    const faceUp = cardFaceUp(entity);
    return {
      ...base,
      width: 0.86,
      depth: 1.22,
      height: 0.09,
      label: faceUp ? definition?.label ?? "Card" : "DIGIPOLOGY",
      color: faceUp ? definition?.color ?? "#e8dfc9" : "#8d3429",
      labelColor: faceUp ? "#17211d" : "#fff2d5",
      labelBackground: faceUp ? "#f3edda" : "#8d3429",
      specular: "#3d3328",
    };
  }
  if (components.die !== undefined) {
    return {
      ...base,
      width: 0.72,
      depth: 0.72,
      height: 0.72,
      label: String(components.die.value),
      color: "#ece7d8",
      labelBackground: "#ece7d8",
      specular: "#6c6558",
    };
  }
  if (components.counter !== undefined) {
    const color = seatColor(entity.id);
    return {
      ...base,
      shape: "cylinder",
      width: 0.76,
      depth: 0.76,
      height: 0.18,
      label: String(components.counter.value),
      color,
      labelColor: "#111713",
      labelBackground: color,
      specular: "#5d4827",
      billboardLabel: true,
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

export function piecePresentationSignature(entity: EntityRecord): string {
  const { card, counter, container, deck, die, button, text, zone } = entity.components;
  const snap = entity.components["snap-point"];
  if (deck !== undefined) return `deck:${deck.enabled}:${container?.items.length ?? 0}`;
  if (card !== undefined) return `card:${card.definitionId}:${cardFaceUp(entity)}`;
  if (die !== undefined) return `die:${String(die.value)}`;
  if (counter !== undefined) return `counter:${counter.value}`;
  if (snap !== undefined) return `snap:${snap.attached?.length ?? 0}`;
  if (zone !== undefined) return `zone:${zone.visibleInPlay}`;
  if (button !== undefined) return `button:${button.enabled}:${button.label}`;
  if (text !== undefined) return `text:${text.value}`;
  return "other";
}
