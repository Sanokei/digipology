export interface CardPresentation {
  label: string;
  color: string;
  imageUrl: string | null;
}

interface CardDefinition {
  label?: string;
  color?: string;
  face?: unknown;
}

/** One compatibility boundary for today's labels/colors and the richer FaceSpec shape. */
export function cardPresentation(definition: CardDefinition | undefined): CardPresentation {
  const face = definition?.face;
  let imageUrl: string | null = null;
  if (typeof face === "object" && face !== null && !Array.isArray(face)) {
    const candidate = Reflect.get(face, "imageUrl") ?? Reflect.get(face, "url") ?? Reflect.get(face, "src");
    if (typeof candidate === "string" && (/^https?:\/\//.test(candidate) || candidate.startsWith("/"))) imageUrl = candidate;
  }
  return {
    label: definition?.label ?? "Card",
    color: definition?.color ?? "#e7dfc8",
    imageUrl,
  };
}
