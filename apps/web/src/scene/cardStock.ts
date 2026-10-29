/** One physical stock profile for the body, printed face and rounded artwork clip. */
export const CARD_STOCK = {
  cornerRadiusRatio: 3 / 63,
  bevelWidthRatio: 0.003,
  singleCardHeight: 0.012,
  surfaceLift: 0.0006,
} as const;

/** Corner radii normalized to the width and height of the printed face. */
export interface CardPaperShape {
  readonly radiusX: number;
  readonly radiusY: number;
}

export interface CardStockProfile {
  readonly radius: number;
  readonly bevel: number;
  readonly faceWidth: number;
  readonly faceDepth: number;
  readonly paperShape: CardPaperShape;
  readonly edgeWidth: number;
  readonly edgeDepth: number;
  readonly edgeHeight: number;
}

export function cardStockProfile(width: number, height: number, depth: number): CardStockProfile {
  if (![width, height, depth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError("Card stock dimensions must be finite and positive");
  }
  const radius = Math.min(width, depth) * CARD_STOCK.cornerRadiusRatio;
  const bevel = Math.min(width * CARD_STOCK.bevelWidthRatio, height / 4, radius / 3);
  const faceWidth = width - 2 * bevel;
  const faceDepth = depth - 2 * bevel;
  const faceRadius = radius - bevel;
  // Printed paper-edge strips stop before the curved corners, including a small
  // inset against texture antialiasing. They never form rectangular corner ears.
  const edgeGuard = width * 0.0015;
  return {
    radius, bevel, faceWidth, faceDepth,
    paperShape: { radiusX: faceRadius / faceWidth, radiusY: faceRadius / faceDepth },
    edgeWidth: Math.max(0, width - 2 * (radius + edgeGuard)),
    edgeDepth: Math.max(0, depth - 2 * (radius + edgeGuard)),
    edgeHeight: height - 2 * bevel,
  };
}

export const DEFAULT_CARD_PAPER_SHAPE: CardPaperShape = cardStockProfile(0.98, CARD_STOCK.singleCardHeight, 1.4).paperShape;
