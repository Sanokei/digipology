import type { PlayingCardIdentity } from "../components/playingCardIdentity";
import { artworkSize, CARD_PIPS, DIE_PIPS, type PieceArtwork } from "./pieceArtwork";

const SUITS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;
const INK = "#203b35";
const PAPER = "#fff9eb";

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

/** An engraved, two-ended court: identifiable people rather than a rank-only placeholder. */
function drawCourtFigure(ctx: CanvasRenderingContext2D, rank: string, symbol: string, ink: string): void {
  const gold = "#d2ad57"; const skin = "#f1d6a5"; const robe = ink === "#b13a32" ? "#b7523f" : "#276d61";
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.fillStyle = "#f6e8c6"; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  roundRect(ctx, 127, 171, 258, 394, 12); ctx.fill(); ctx.stroke();
  ctx.save(); roundRect(ctx, 133, 177, 246, 382, 8); ctx.clip();
  ctx.strokeStyle = "#bda572"; ctx.globalAlpha = 0.24; ctx.lineWidth = 1;
  for (let x = -260; x < 600; x += 13) { ctx.beginPath(); ctx.moveTo(x, 170); ctx.lineTo(x + 394, 565); ctx.stroke(); }
  ctx.globalAlpha = 1;
  for (let half = 0; half < 2; half++) {
    ctx.save(); ctx.translate(256, 368); if (half) ctx.rotate(Math.PI);
    ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
    // Brocade shoulders, contrasting sleeves and a folded cream collar.
    ctx.fillStyle = gold; ctx.beginPath(); ctx.moveTo(-121, 0); ctx.lineTo(-106, -49);
    ctx.quadraticCurveTo(-86, -75, -39, -80); ctx.lineTo(39, -80);
    ctx.quadraticCurveTo(86, -75, 106, -49); ctx.lineTo(121, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = robe; ctx.beginPath(); ctx.moveTo(-70, -70); ctx.lineTo(-36, -79); ctx.lineTo(44, 0); ctx.lineTo(-49, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(70, -70); ctx.lineTo(36, -79); ctx.lineTo(-4, -16); ctx.lineTo(71, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff7de"; ctx.beginPath(); ctx.moveTo(-30, -82); ctx.lineTo(0, -42); ctx.lineTo(30, -82); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1;
    for (let stripe = 0; stripe < 4; stripe++) {
      const y = -47 + stripe * 12;
      ctx.beginPath(); ctx.moveTo(-105 - stripe * 3, y); ctx.lineTo(-77 - stripe * 2, y + 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(105 + stripe * 3, y); ctx.lineTo(77 + stripe * 2, y + 8); ctx.stroke();
    }
    ctx.fillStyle = "#fff0c8";
    for (const x of [-58, 59]) for (const y of [-35, -13]) { diamond(ctx, x, y, 7, 10); ctx.fill(); }
    // Hair silhouette and neck behind the face.
    ctx.fillStyle = rank === "K" ? "#6c7257" : "#c6a256"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-34, -151); ctx.bezierCurveTo(-55, -135, -47, -96, -39, -72);
    ctx.quadraticCurveTo(-17, -61, 0, -78); ctx.quadraticCurveTo(17, -61, 39, -72);
    ctx.bezierCurveTo(47, -96, 55, -135, 34, -151); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = skin; ctx.fillRect(-12, -94, 24, 24);
    ctx.beginPath(); ctx.ellipse(0, -116, 29, 38, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (rank === "K") {
      ctx.fillStyle = "#e7d3a0"; ctx.beginPath(); ctx.moveTo(-27, -111);
      ctx.bezierCurveTo(-24, -86, -18, -72, 0, -64); ctx.bezierCurveTo(18, -72, 24, -86, 27, -111);
      ctx.lineTo(17, -102); ctx.quadraticCurveTo(0, -87, -17, -102); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
      for (const x of [-13, -5, 5, 13]) { ctx.beginPath(); ctx.moveTo(x, -96); ctx.quadraticCurveTo(x * 0.9, -80, x * 0.35, -72); ctx.stroke(); }
    } else {
      ctx.lineWidth = 1;
      for (const side of [-1, 1]) for (let lock = 0; lock < 3; lock++) {
        const x = side * (33 + lock * 4);
        ctx.beginPath(); ctx.moveTo(x, -137); ctx.bezierCurveTo(x - side * 8, -116, x + side * 7, -102, x - side * 6, -79); ctx.stroke();
      }
    }
    // Fine facial engraving stays readable in the large inspection view.
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.6;
    for (const x of [-12, 11]) { ctx.beginPath(); ctx.moveTo(x - 5, -121); ctx.quadraticCurveTo(x, -125, x + 5, -121); ctx.stroke(); ctx.beginPath(); ctx.arc(x, -120, 1.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(1, -117); ctx.lineTo(-2, -106); ctx.lineTo(4, -105); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-7, -98); ctx.quadraticCurveTo(0, -94, 7, -98); ctx.stroke();
    // Distinct regalia: royal crowns, queen's pearls, and the jack's feathered cap.
    ctx.fillStyle = gold; ctx.lineWidth = 2;
    ctx.beginPath();
    if (rank === "J") {
      ctx.moveTo(-36, -150); ctx.bezierCurveTo(-43, -176, -15, -183, 4, -173);
      ctx.bezierCurveTo(17, -186, 39, -173, 35, -150); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = robe; roundRect(ctx, -36, -154, 72, 11, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff7de"; ctx.beginPath(); ctx.moveTo(21, -170); ctx.quadraticCurveTo(39, -191, 56, -179);
      ctx.quadraticCurveTo(35, -176, 21, -162); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.moveTo(-36, -153); ctx.lineTo(-39, -174); ctx.lineTo(-22, -164);
      ctx.lineTo(-15, rank === "K" ? -183 : -174); ctx.lineTo(0, -166);
      ctx.lineTo(13, -184); ctx.lineTo(23, -164); ctx.lineTo(39, -174); ctx.lineTo(36, -153); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff0c7"; roundRect(ctx, -35, -155, 70, 11, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = robe;
      for (const x of [-23, 0, 23]) { diamond(ctx, x, -150, 6, 7); ctx.fill(); }
    }
    if (rank === "Q") {
      ctx.fillStyle = "#fff9e7";
      for (let pearl = -2; pearl <= 2; pearl++) { ctx.beginPath(); ctx.arc(pearl * 7, -77 + (2 - Math.abs(pearl)) * 2, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.strokeStyle = ink; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(88, -4); ctx.lineTo(82, -142); ctx.stroke();
    ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(82, -146, rank === "Q" ? 9 : 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (rank === "Q") { ctx.fillStyle = robe; ctx.beginPath(); ctx.arc(82, -146, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = ink; ctx.font = "39px Georgia, 'DejaVu Serif', serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(symbol, 23, -20);
    ctx.restore();
  }
  ctx.restore(); ctx.strokeStyle = ink; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(132, 368); ctx.lineTo(380, 368); ctx.stroke(); ctx.restore();
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
    drawCourtFigure(ctx, identity.rank, symbol, ink);
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
  // Only ink is overlaid. The rounded ivory body supplies the continuous face
  // and edge shading, so the six surfaces never look like square stickers.
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

function drawCounter(ctx: CanvasRenderingContext2D, width: number, height: number, value: number, color: string): void {
  const x = width / 2; const y = height / 2;
  ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(color) ? color : "#d2ad57";
  ctx.beginPath(); ctx.arc(x, y, width / 2 - 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#263f34"; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = "#fff5dd";
  for (let notch = 0; notch < 12; notch++) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(notch * Math.PI / 6);
    roundRect(ctx, -6, -height / 2 + 6, 12, 24, 3); ctx.fill(); ctx.restore();
  }
  ctx.strokeStyle = "#fff5dd"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, width * 0.405, 0, Math.PI * 2); ctx.stroke();
  const paper = ctx.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#fffdf3"); paper.addColorStop(1, "#ecdab4"); ctx.fillStyle = paper;
  ctx.beginPath(); ctx.arc(x, y, width * 0.345, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#5d604c"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const label = String(value); ctx.font = `bold ${label.length > 3 ? 72 : 109}px Manrope, sans-serif`;
  ctx.fillText(label, x, y + 3, width * 0.62);
}

/** Paints an actual raster texture; it never reads canonical state or hidden definitions. */
export function drawPieceArtwork(ctx: CanvasRenderingContext2D, width: number, height: number, artwork: PieceArtwork): void {
  ctx.save(); ctx.clearRect(0, 0, width, height);
  const [designWidth, designHeight] = artworkSize(artwork);
  ctx.scale(width / designWidth, height / designHeight);
  width = designWidth; height = designHeight;
  switch (artwork.kind) {
    case "card-back": drawCardBack(ctx, width, height, artwork); break;
    case "standard-card": drawStandardCard(ctx, width, height, artwork.identity); break;
    case "custom-card": drawCustomCard(ctx, width, height, artwork); break;
    case "die-face": drawDie(ctx, width, height, artwork); break;
    case "counter-face": drawCounter(ctx, width, height, artwork.value, artwork.color); break;
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
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = (seed >>> 12) % width;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const y = (seed >>> 12) % height;
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
