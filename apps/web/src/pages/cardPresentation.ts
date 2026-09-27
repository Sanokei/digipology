import { renderFaceSvg } from "digipology-faces";
import type { PieceDefinitionDto } from "digipology-protocol/http";

export interface CardPresentation {
  label: string;
  color: string;
  imageUrl: string | null;
}

/** One compatibility boundary for today's labels/colors and the richer FaceSpec shape. */
export function cardPresentation(definition: PieceDefinitionDto | undefined): CardPresentation {
  const imageUrl = definition?.face === undefined
    ? null
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderFaceSvg(definition.face, 600, 840))}`;
  return {
    label: definition?.label ?? "Card",
    color: definition?.color ?? "#e7dfc8",
    imageUrl,
  };
}
