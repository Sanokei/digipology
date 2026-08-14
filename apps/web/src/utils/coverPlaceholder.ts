export interface CoverPlaceholder {
  hue: number;
  background: string;
}

export function coverPlaceholder(slug: string): CoverPlaceholder {
  let hue = 7;
  for (const character of slug) hue = (hue * 31 + character.charCodeAt(0)) % 360;
  return {
    hue,
    background: `linear-gradient(160deg, hsl(${hue} 42% 26%), hsl(${(hue + 40) % 360} 38% 14%))`,
  };
}
