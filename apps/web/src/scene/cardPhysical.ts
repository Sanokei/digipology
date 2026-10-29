import { TABLE_SURFACE_Y } from "./tableDimensions";

/** Old cards used a .045 center offset. Thin printed stock still rests on felt. */
export function physicalPieceY(authoredY: number, restingY: number, thinCard = false): number {
  if (thinCard && authoredY >= TABLE_SURFACE_Y && authoredY <= TABLE_SURFACE_Y + 0.045 + 1e-8) return restingY;
  return Math.max(authoredY, restingY);
}

/** Presentation stock thickness must not alter the existing canonical drop convention. */
export function canonicalPieceY(physicalY: number, restingY: number, thinCard = false): number {
  return thinCard && physicalY <= restingY + 1e-8 ? TABLE_SURFACE_Y + 0.045 : physicalY;
}
