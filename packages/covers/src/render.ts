import type { CoverSpec } from "./spec";

const WIDTH = 336;
const HEIGHT = 504;

/** Renders a byte-stable, safe-by-construction 2:3 SVG cover. */
export function renderCoverSvg(
  spec: CoverSpec,
  text: { title: string; tagline?: string },
): string {
  const random = prng(spec.seed >>> 0);
  const palette = spec.palette;
  const title = safeText(text.title, 72, "Untitled Game");
  const tagline = safeText(text.tagline ?? "", 120, "");
  const fragments: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${color(palette, 0)}"/>`,
    ...layout(spec.layout, palette, random),
    `<rect x="18" y="18" width="300" height="468" rx="18" fill="none" stroke="${color(palette, 3)}" stroke-width="2" opacity="0.36"/>`,
    ...motif(spec.motif, palette, random),
    ...titleBlock(spec.titleTreatment, title, tagline, palette),
    "</svg>",
  ];
  return fragments.join("");
}

type Random = () => number;

function layout(kind: CoverSpec["layout"], palette: string[], random: Random): string[] {
  switch (kind) {
    case "banded":
      return Array.from({ length: 5 }, (_, index) => {
        const height = 38 + Math.floor(random() * 58);
        const y = index * 98 + Math.floor(random() * 26) - 12;
        return `<rect x="-12" y="${y}" width="360" height="${height}" fill="${color(palette, index + 1)}" opacity="${decimal(0.12 + random() * 0.16)}"/>`;
      });
    case "diagonal": {
      const offset = Math.floor(random() * 76) - 38;
      return [
        `<polygon points="0,${112 + offset} 336,${26 + offset} 336,230 0,316" fill="${color(palette, 1)}" opacity="0.28"/>`,
        `<polygon points="0,${270 + offset} 336,${184 + offset} 336,278 0,364" fill="${color(palette, 2)}" opacity="0.24"/>`,
        `<line x1="-20" y1="${392 + offset}" x2="356" y2="${296 + offset}" stroke="${color(palette, 3)}" stroke-width="9" opacity="0.42"/>`,
      ];
    }
    case "radial": {
      const cx = 168 + Math.floor((random() - 0.5) * 72);
      const cy = 220 + Math.floor((random() - 0.5) * 96);
      return [190, 144, 98, 54].map((radius, index) =>
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color(palette, index + 1)}" opacity="${decimal(0.07 + index * 0.035)}"/>`);
    }
    case "grid": {
      const cells: string[] = [];
      for (let row = 0; row < 7; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          const inset = 3 + Math.floor(random() * 7);
          cells.push(`<rect x="${column * 68 + inset}" y="${row * 68 + inset}" width="${62 - inset * 2}" height="${62 - inset * 2}" rx="${4 + Math.floor(random() * 8)}" fill="${color(palette, row + column + 1)}" opacity="${decimal(0.08 + random() * 0.16)}"/>`);
        }
      }
      return cells;
    }
    case "corner":
      return [
        `<circle cx="${20 + Math.floor(random() * 34)}" cy="${45 + Math.floor(random() * 40)}" r="150" fill="${color(palette, 1)}" opacity="0.22"/>`,
        `<circle cx="${310 - Math.floor(random() * 34)}" cy="${430 - Math.floor(random() * 40)}" r="174" fill="${color(palette, 2)}" opacity="0.18"/>`,
        `<polygon points="236,0 336,0 336,154" fill="${color(palette, 3)}" opacity="0.3"/>`,
      ];
  }
}

function motif(kind: CoverSpec["motif"], palette: string[], random: Random): string[] {
  const accent = color(palette, 1);
  const light = color(palette, 3);
  switch (kind) {
    case "cards": {
      const cards: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const angle = -18 + index * 18 + Math.floor((random() - 0.5) * 6);
        const x = 70 + index * 48;
        const y = 138 - Math.abs(index - 1) * 9;
        cards.push(`<g transform="rotate(${angle} ${x + 54} ${y + 78})"><rect x="${x}" y="${y}" width="108" height="156" rx="12" fill="${index === 1 ? light : color(palette, 0)}" stroke="${accent}" stroke-width="4"/><circle cx="${x + 54}" cy="${y + 78}" r="${14 + index * 3}" fill="none" stroke="${accent}" stroke-width="5"/><line x1="${x + 35}" y1="${y + 78}" x2="${x + 73}" y2="${y + 78}" stroke="${accent}" stroke-width="4"/></g>`);
      }
      return cards;
    }
    case "dice": {
      const dice: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const x = 62 + index * 112;
        const y = 146 + index * 46;
        const angle = (index === 0 ? -10 : 9) + Math.floor((random() - 0.5) * 8);
        dice.push(`<g transform="rotate(${angle} ${x + 54} ${y + 54})"><rect x="${x}" y="${y}" width="108" height="108" rx="20" fill="${index === 0 ? light : color(palette, 0)}" stroke="${accent}" stroke-width="4"/>${pips(x, y, index === 0 ? [0, 4, 8] : [0, 2, 6, 8], index === 0 ? color(palette, 0) : accent)}</g>`);
      }
      return dice;
    }
    case "meeples": {
      const meeples: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const x = 74 + index * 86 + Math.floor((random() - 0.5) * 12);
        const y = 180 + Math.floor(random() * 42);
        const fill = color(palette, index + 1);
        meeples.push(`<g><circle cx="${x}" cy="${y}" r="25" fill="${fill}" stroke="${light}" stroke-width="3"/><path d="M${x - 18} ${y + 19} L${x - 43} ${y + 74} L${x - 19} ${y + 78} L${x} ${y + 48} L${x + 19} ${y + 78} L${x + 43} ${y + 74} L${x + 18} ${y + 19} Z" fill="${fill}" stroke="${light}" stroke-width="3" stroke-linejoin="round"/></g>`);
      }
      return meeples;
    }
    case "abstract": {
      const shapes: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        const x = 48 + Math.floor(random() * 240);
        const y = 108 + Math.floor(random() * 230);
        const radius = 13 + Math.floor(random() * 42);
        shapes.push(index % 2 === 0
          ? `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color(palette, index + 1)}" opacity="${decimal(0.42 + random() * 0.4)}"/>`
          : `<rect x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" rx="${Math.floor(radius / 3)}" fill="${color(palette, index + 1)}" opacity="${decimal(0.38 + random() * 0.42)}" transform="rotate(${Math.floor(random() * 70) - 35} ${x} ${y})"/>`);
      }
      return shapes;
    }
  }
}

function titleBlock(
  treatment: CoverSpec["titleTreatment"],
  title: string,
  tagline: string,
  palette: string[],
): string[] {
  const foreground = color(palette, 3);
  const accent = color(palette, 1);
  const lines = treatment === "stacked" ? splitTitle(title) : [title];
  const result: string[] = [];
  if (treatment === "boxed") {
    result.push(`<rect x="32" y="370" width="272" height="91" rx="10" fill="${color(palette, 0)}" stroke="${accent}" stroke-width="3"/>`);
  }
  const titleY = treatment === "stacked" && lines.length > 1 ? 390 : 414;
  lines.forEach((line, index) => {
    result.push(`<text x="42" y="${titleY + index * 38}" fill="${foreground}" font-family="Inter,Arial,sans-serif" font-size="${treatment === "minimal" ? 28 : 34}" font-weight="800" letter-spacing="${treatment === "minimal" ? 0 : -1}">${line}</text>`);
  });
  if (treatment === "underlined") {
    result.push(`<line x1="42" y1="426" x2="294" y2="426" stroke="${accent}" stroke-width="5"/>`);
  }
  if (tagline !== "") {
    const taglineY = treatment === "stacked" && lines.length > 1 ? 472 : 452;
    result.push(`<text x="42" y="${taglineY}" fill="${treatment === "boxed" ? accent : foreground}" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="600" letter-spacing="1" opacity="0.82">${tagline}</text>`);
  }
  return result;
}

function pips(x: number, y: number, indexes: number[], fill: string): string {
  return indexes.map((index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return `<circle cx="${x + 27 + column * 27}" cy="${y + 27 + row * 27}" r="7" fill="${fill}"/>`;
  }).join("");
}

function splitTitle(title: string): string[] {
  const words = title.split(" ");
  if (words.length < 2 || title.length <= 18) return [title];
  let best = 1;
  let difference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(" ").length;
    const right = words.slice(index).join(" ").length;
    if (Math.abs(left - right) < difference) {
      difference = Math.abs(left - right);
      best = index;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function safeText(value: string, maximum: number, fallback: string): string {
  const compact = value.trim().replaceAll(/\s+/g, " ") || fallback;
  const characters = Array.from(compact);
  const clamped = characters.length <= maximum
    ? compact
    : characters.slice(0, maximum - 1).join("").trimEnd() + "…";
  return clamped
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("=", "&#61;")
    .replaceAll(":", "&#58;");
}

function color(palette: string[], index: number): string {
  return palette[index % palette.length]!;
}

function decimal(value: number): string {
  return value.toFixed(3);
}

function prng(seed: number): Random {
  let state = (seed ^ 0xa5a5_a5a5) >>> 0;
  if (state === 0) state = 0x6d2b_79f5;
  return () => {
    state += 0x6d2b_79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}
