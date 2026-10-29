import type { EntityRecord } from "digipology-kernel";
import { playingCardIdentity, type PlayingCardIdentity } from "../components/playingCardIdentity";

/** Presentation data only. A hidden card never carries its definition into artwork. */
export type PieceArtwork =
  | { readonly kind: "card-back"; readonly count?: number; readonly enabled?: boolean }
  | { readonly kind: "standard-card"; readonly identity: PlayingCardIdentity }
  | { readonly kind: "custom-card"; readonly label: string; readonly accent: string }
  | { readonly kind: "die-face"; readonly value: number | string; readonly pips: boolean }
  | { readonly kind: "paper-edge"; readonly count: number }
  | { readonly kind: "contact-shadow" }
  | { readonly kind: "felt" }
  | { readonly kind: "wood" };

export interface ArtworkDefinition { readonly label?: string; readonly color?: string }

const SUITS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;
const INK = "#203b35";
const PAPER = "#fff9eb";

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
  const standardFaces = die?.faces === undefined || (die.faces.length === 6
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function paper(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#fffdf5"); gradient.addColorStop(0.6, PAPER); gradient.addColorStop(1, "#eee2c9");
  ctx.fillStyle = gradient;
  roundRect(ctx, 2, 2, width - 4, height - 4, 38); ctx.fill();
  ctx.strokeStyle = "#cbbf9f"; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = "rgba(111, 96, 65, .22)";
  ctx.lineWidth = 1;
  roundRect(ctx, 16, 16, width - 32, height - 32, 29); ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height = width): void {
  ctx.beginPath(); ctx.moveTo(x, y - height / 2); ctx.lineTo(x + width / 2, y);
  ctx.lineTo(x, y + height / 2); ctx.lineTo(x - width / 2, y); ctx.closePath();
}

function drawCardBack(ctx: CanvasRenderingContext2D, width: number, height: number, artwork: Extract<PieceArtwork, { kind: "card-back" }>): void {
  paper(ctx, width, height);
  const empty = artwork.count === 0;
  ctx.fillStyle = empty ? "#ded7c5" : artwork.enabled === false ? "#586c64" : "#12584f";
  roundRect(ctx, 24, 24, width - 48, height - 48, 24); ctx.fill();
  ctx.save(); roundRect(ctx, 32, 32, width - 64, height - 64, 19); ctx.clip();
  ctx.lineWidth = 2; ctx.strokeStyle = empty ? "rgba(71, 86, 72, .14)" : "rgba(225, 207, 144, .25)";
  for (let offset = -height; offset < width + height; offset += 28) {
    ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset + height, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset - height, height); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = empty ? "#b7b09c" : "#dfc889"; ctx.lineWidth = 3;
  roundRect(ctx, 37, 37, width - 74, height - 74, 15); ctx.stroke();
  roundRect(ctx, 47, 47, width - 94, height - 94, 10); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = empty ? "#ded7c5" : "#124f47";
  diamond(ctx, width / 2, height / 2, 274, 348); ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
  diamond(ctx, width / 2, height / 2, 248, 316); ctx.lineWidth = 1; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = empty ? "#65715f" : "#f2dfab";
  ctx.font = "bold 106px Georgia, 'DejaVu Serif', serif";
  ctx.fillText(empty ? "—" : "D", width / 2, height / 2 + 3);
  for (const y of [height / 2 - 107, height / 2 + 107]) { diamond(ctx, width / 2, y, 15); ctx.fill(); }
  if (artwork.count !== undefined) {
    const text = artwork.count === 0 ? "EMPTY" : String(artwork.count);
    ctx.fillStyle = "#fff6de"; roundRect(ctx, width / 2 - 87, height - 166, 174, 98, 49); ctx.fill();
    ctx.strokeStyle = "#c5a86a"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `bold ${artwork.count === 0 ? 31 : 53}px Manrope, sans-serif`;
    ctx.fillText(text, width / 2, height - 115);
  }
}

function drawStandardCard(ctx: CanvasRenderingContext2D, width: number, height: number, identity: PlayingCardIdentity): void {
  paper(ctx, width, height);
  const symbol = SUITS[identity.suit];
  const ink = identity.suit === "hearts" || identity.suit === "diamonds" ? "#b13a32" : "#203b35";
  ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let corner = 0; corner < 2; corner++) {
    ctx.save(); if (corner) { ctx.translate(width, height); ctx.rotate(Math.PI); }
    ctx.font = "bold 66px Georgia, 'DejaVu Serif', serif"; ctx.fillText(identity.rank, 64, 65);
    ctx.font = "58px Georgia, 'DejaVu Serif', serif"; ctx.fillText(symbol, 64, 125); ctx.restore();
  }
  const pips = CARD_PIPS[Number(identity.rank)];
  if (pips !== undefined) {
    ctx.font = "82px Georgia, 'DejaVu Serif', serif";
    for (const [column, row] of pips) {
      const x = width / 2 + column * 91; const y = 192 + row * 88;
      ctx.save(); ctx.translate(x, y); if (row > 2) ctx.rotate(Math.PI); ctx.fillText(symbol, 0, 0); ctx.restore();
    }
  } else if (identity.rank === "A") {
    ctx.font = "206px Georgia, 'DejaVu Serif', serif"; ctx.fillText(symbol, width / 2, height / 2 + 4);
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    for (const y of [210, height - 210]) { ctx.beginPath(); ctx.moveTo(190, y); ctx.lineTo(width - 190, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = ink; ctx.lineWidth = 3;
    diamond(ctx, width / 2, height / 2, 270, 393); ctx.stroke();
    diamond(ctx, width / 2, height / 2, 246, 363); ctx.lineWidth = 1; ctx.stroke();
    ctx.font = "bold 135px Georgia, 'DejaVu Serif', serif"; ctx.fillText(identity.rank, width / 2, height / 2 - 43);
    ctx.font = "111px Georgia, 'DejaVu Serif', serif"; ctx.fillText(symbol, width / 2, height / 2 + 83);
  }
}

function wrappedLabel(ctx: CanvasRenderingContext2D, label: string, width: number): string[] {
  const words = label.trim().split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) {
    const proposed = line ? `${line} ${word}` : word;
    if (ctx.measureText(proposed).width > width && line) { lines.push(line); line = word; } else line = proposed;
  }
  if (line) lines.push(line);
  if (lines.length > 5) return [...lines.slice(0, 4), `${lines[4]!.slice(0, 18)}…`];
  return lines;
}

function drawCustomCard(ctx: CanvasRenderingContext2D, width: number, height: number, artwork: Extract<PieceArtwork, { kind: "custom-card" }>): void {
  paper(ctx, width, height);
  ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(artwork.accent) ? artwork.accent : "#277267";
  roundRect(ctx, 30, 30, width - 60, 116, 18); ctx.fill();
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
  roundRect(ctx, 30, 30, width - 60, height - 60, 18); ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, .85)"; diamond(ctx, width / 2, 88, 32); ctx.fill();
  ctx.fillStyle = INK; ctx.font = "bold 54px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lines = wrappedLabel(ctx, artwork.label, width - 98);
  const start = height / 2 - (lines.length - 1) * 34 + 25;
  for (const [index, line] of lines.entries()) ctx.fillText(line, width / 2, start + index * 68, width - 98);
}

function drawDie(ctx: CanvasRenderingContext2D, width: number, height: number, artwork: Extract<PieceArtwork, { kind: "die-face" }>): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#fffaf0"); gradient.addColorStop(1, "#eee5d4");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  const pips = artwork.pips ? DIE_PIPS[Number(artwork.value)] : undefined;
  if (pips !== undefined) {
    for (const [column, row] of pips) {
      const x = width / 2 + column * 77; const y = height / 2 + row * 77;
      const radius = pips.length === 1 ? 27 : 23;
      const pip = ctx.createRadialGradient(x + 5, y + 7, 2, x, y, radius);
      const ink = artwork.value === 1 ? "#a93d2f" : "#19382e";
      pip.addColorStop(0, ink); pip.addColorStop(0.78, ink); pip.addColorStop(1, "#5d695b");
      ctx.fillStyle = pip; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, .65)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y + 1, radius + 1, 0.13, Math.PI - 0.13); ctx.stroke();
    }
  } else {
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const label = String(artwork.value); ctx.font = `bold ${label.length > 4 ? 49 : 108}px Manrope, sans-serif`;
    const lines = wrappedLabel(ctx, label, width - 28);
    const top = height / 2 - (lines.length - 1) * 27;
    for (const [index, line] of lines.entries()) ctx.fillText(line, width / 2, top + index * 54, width - 28);
  }
}

/** Paints an actual raster texture; it never reads canonical state or hidden definitions. */
export function drawPieceArtwork(ctx: CanvasRenderingContext2D, width: number, height: number, artwork: PieceArtwork): void {
  ctx.save(); ctx.clearRect(0, 0, width, height);
  switch (artwork.kind) {
    case "card-back": drawCardBack(ctx, width, height, artwork); break;
    case "standard-card": drawStandardCard(ctx, width, height, artwork.identity); break;
    case "custom-card": drawCustomCard(ctx, width, height, artwork); break;
    case "die-face": drawDie(ctx, width, height, artwork); break;
    case "paper-edge": {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#f5eedc"); gradient.addColorStop(1, "#bfb39b"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
      const layers = Math.min(artwork.count, 36); ctx.lineWidth = 1;
      for (let layer = 1; layer < layers; layer++) {
        const y = layer * height / layers; ctx.strokeStyle = layer % 3 ? "rgba(88, 76, 51, .32)" : "rgba(255, 255, 255, .9)";
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      break;
    }
    case "contact-shadow": {
      const shadow = ctx.createRadialGradient(width / 2, height / 2, 12, width / 2, height / 2, width / 2);
      shadow.addColorStop(0, "rgba(0, 0, 0, .65)"); shadow.addColorStop(0.55, "rgba(0, 0, 0, .29)"); shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = shadow; ctx.fillRect(0, 0, width, height); break;
    }
    case "felt": case "wood": {
      const felt = artwork.kind === "felt";
      ctx.fillStyle = felt ? "#235b4c" : "#513526"; ctx.fillRect(0, 0, width, height);
      // Fixed integer noise keeps the cloth/grain consistent across both adapters.
      let seed = 7351;
      for (let index = 0; index < (felt ? 34000 : 7000); index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = seed % width;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const y = seed % height;
        ctx.fillStyle = index % 2 ? "rgba(255, 239, 197, .07)" : "rgba(0, 18, 12, .12)";
        ctx.fillRect(x, y, felt ? 1 : 90 + seed % 210, felt ? 2 : 1);
      }
      if (felt) {
        const glow = ctx.createRadialGradient(width / 2, height / 2, width * 0.12, width / 2, height / 2, width * 0.72);
        glow.addColorStop(0, "rgba(97, 151, 119, .12)"); glow.addColorStop(1, "rgba(0, 21, 15, .26)");
        ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(224, 202, 147, .17)"; ctx.lineWidth = 2;
        roundRect(ctx, 38, 38, width - 76, height - 76, 24); ctx.stroke();
        ctx.strokeStyle = "rgba(224, 202, 147, .08)"; roundRect(ctx, 43, 43, width - 86, height - 86, 20); ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

export function createArtworkCanvas(artwork: PieceArtwork): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = artworkSize(artwork);
  const context = canvas.getContext("2d");
  if (context !== null) drawPieceArtwork(context, canvas.width, canvas.height, artwork);
  return canvas;
}
