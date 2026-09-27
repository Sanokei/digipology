import { faceSpecHash, type FaceSpec } from "digipology-faces";
import type { EntityRecord } from "digipology-kernel";
import type { PieceDefinitionDto, PieceShapeDto } from "digipology-protocol/http";

import { seatPaletteEntry } from "../seatPalette";

export type PieceShape = PieceShapeDto;
export type PieceDefinition = PieceDefinitionDto;

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
  readonly face?: FaceSpec;
  readonly isBoard: boolean;
}

function cardFaceUp(entity: EntityRecord): boolean {
  const { card, flippable } = entity.components;
  return flippable?.flipped ?? card?.faceUp ?? false;
}

export function seatColor(entityOrSeatId: string): string {
  return seatPaletteEntry(entityOrSeatId).color;
}

function definitionBackVisible(entity: EntityRecord): boolean {
  return entity.components.card !== undefined ? !cardFaceUp(entity) : entity.components.flippable?.flipped === true;
}

function shapeDefaults(shape: PieceShape): Pick<PiecePresentation, "width" | "depth" | "height"> {
  switch (shape) {
    case "cube": return { width: 0.72, depth: 0.72, height: 0.72 };
    case "card": return { width: 0.86, depth: 1.22, height: 0.09 };
    case "board": return { width: 8, depth: 6, height: 0.12 };
    case "token": return { width: 0.68, depth: 0.68, height: 0.08 };
    case "disc": return { width: 0.8, depth: 0.8, height: 0.14 };
    case "pawn": return { width: 0.66, depth: 0.66, height: 1.05 };
    case "meeple": return { width: 0.82, depth: 0.38, height: 0.92 };
    case "hex": return { width: 1, depth: 0.88, height: 0.16 };
    case "ring": return { width: 1.02, depth: 1.02, height: 0.08 };
    case "cylinder": return { width: 0.76, depth: 0.76, height: 0.18 };
    case "box": return { width: 0.9, depth: 0.9, height: 0.18 };
  }
}

function applyDefinition(presentation: PiecePresentation, entity: EntityRecord, definition: PieceDefinition | undefined): PiecePresentation {
  if (definition === undefined) return presentation;
  const back = definitionBackVisible(entity);
  const size = definition.size;
  const tintSeat = entity.components.appearance?.seat ?? entity.id;
  const color = definition.seatTint === true ? seatColor(tintSeat)
    : back ? definition.backColor ?? presentation.color : definition.color ?? presentation.color;
  const label = back ? definition.backLabel ?? presentation.label : definition.label ?? presentation.label;
  return {
    ...presentation,
    ...(definition.shape === undefined ? {} : { shape: definition.shape, ...shapeDefaults(definition.shape) }),
    ...(size === undefined ? {} : { width: size.w, depth: size.d, height: size.h }),
    color,
    label,
    labelBackground: color,
    labelColor: definition.seatTint === true ? seatPaletteEntry(tintSeat).textColor : presentation.labelColor,
    ...(back ? definition.back === undefined ? {} : { face: definition.back } : definition.face === undefined ? {} : { face: definition.face }),
    isBoard: definition.shape === "board",
  };
}

export function piecePresentation(entity: EntityRecord, definition?: PieceDefinition): PiecePresentation {
  const { components } = entity;
  const base: PiecePresentation = {
    shape: "box", width: 0.9, depth: 0.9, height: 0.18, label: "", color: "#d7b26d",
    labelColor: "#13211c", labelBackground: "#f2ecd9", specular: "#281d13",
    emissive: "#000000", alpha: 1, billboardLabel: false, isBoard: false,
  };
  let result: PiecePresentation;
  if (components.deck !== undefined) result = {
    ...base, width: 1.02, depth: 1.42, height: 0.14 + Math.min(components.container?.items.length ?? 0, 20) * 0.012,
    label: `Deck · ${components.container?.items.length ?? 0}`, color: components.deck.enabled ? "#6f382b" : "#46413d",
    labelColor: "#fff5df", labelBackground: "#6f382b",
  };
  else if (components.card !== undefined) {
    const faceUp = cardFaceUp(entity);
    result = { ...base, width: 0.86, depth: 1.22, height: 0.09,
      label: faceUp ? definition?.label ?? "Card" : definition?.backLabel ?? "DIGIPOLOGY",
      color: faceUp ? definition?.color ?? "#e8dfc9" : definition?.backColor ?? "#8d3429",
      labelColor: faceUp ? "#17211d" : "#fff2d5", labelBackground: faceUp ? "#f3edda" : "#8d3429", specular: "#3d3328" };
  }
  else if (components.die !== undefined) result = { ...base, width: 0.72, depth: 0.72, height: 0.72, label: String(components.die.value), color: "#ece7d8", labelBackground: "#ece7d8", specular: "#6c6558" };
  else if (components.counter !== undefined) { const color = seatColor(entity.id); result = { ...base, shape: "cylinder", width: 0.76, depth: 0.76, height: 0.18, label: String(components.counter.value), color, labelColor: "#111713", labelBackground: color, specular: "#5d4827", billboardLabel: true }; }
  else if (components.zone !== undefined) result = { ...base, width: 1, depth: 1, height: 0.028, color: "#66c69c", specular: "#000000", emissive: "#12372b", alpha: components.zone.visibleInPlay ? 0.16 : 0 };
  else if (components["snap-point"] !== undefined) { const occupied = (components["snap-point"].attached?.length ?? 0) > 0; result = { ...base, shape: "ring", width: 1.02, depth: 1.02, height: 0.08, color: occupied ? "#d5ff76" : "#203b31", specular: "#0a1511", emissive: occupied ? "#34441c" : "#07130f", alpha: 0.92 }; }
  else if (components.text !== undefined) result = { ...base, width: 2.5, depth: 0.7, height: 0.07, label: components.text.value, color: "#14261f", labelColor: "#d9efdf", labelBackground: "#14261f", specular: "#07110e", emissive: "#091a14" };
  else if (components.button !== undefined) result = { ...base, width: 1.05, depth: 0.72, height: 0.2, label: components.button.label, color: components.button.enabled ? "#d5ff76" : "#625f58", labelBackground: components.button.enabled ? "#d5ff76" : "#625f58" };
  else if (components.tags?.values.includes("runner") === true || components.grabbable !== undefined) { const color = seatColor(entity.id); result = { ...base, shape: "cylinder", width: 0.68, depth: 0.68, height: 0.24, color, specular: "#5b4325", emissive: "#0d1511" }; }
  else if (components.transform !== undefined) result = { ...base, label: "Table object" };
  else result = base;
  return applyDefinition(result, entity, definition);
}

export function piecePresentationSignature(entity: EntityRecord, definition?: PieceDefinition): string {
  const { card, counter, container, deck, die, button, text, zone, appearance } = entity.components;
  const snap = entity.components["snap-point"];
  const semantic = deck !== undefined ? `deck:${deck.enabled}:${container?.items.length ?? 0}`
    : card !== undefined ? `card:${card.definitionId}:${cardFaceUp(entity)}`
    : die !== undefined ? `die:${String(die.value)}` : counter !== undefined ? `counter:${counter.value}`
    : snap !== undefined ? `snap:${snap.attached?.length ?? 0}` : zone !== undefined ? `zone:${zone.visibleInPlay}`
    : button !== undefined ? `button:${button.enabled}:${button.label}` : text !== undefined ? `text:${text.value}` : "other";
  if (definition === undefined && appearance === undefined) return semantic;
  if (definition === undefined) return `${semantic}:${appearance?.definitionId ?? ""}:${appearance?.seat ?? ""}`;
  const size = definition.size;
  const front = definition.face === undefined ? "" : faceSpecHash(definition.face);
  const back = definition.back === undefined ? "" : faceSpecHash(definition.back);
  return `${semantic}:${appearance?.definitionId ?? ""}:${appearance?.seat ?? ""}:${definition.shape ?? ""}:${size?.w ?? ""}:${size?.d ?? ""}:${size?.h ?? ""}:${definition.color ?? ""}:${definition.backColor ?? ""}:${definition.label ?? ""}:${definition.backLabel ?? ""}:${definition.seatTint ?? ""}:${front}:${back}`;
}
