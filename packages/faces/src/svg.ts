import { ICON_PATHS, PIP_POINTS } from "./icons";
import type { FaceElement, FaceFill, FaceIconName, FaceSpec } from "./types";

const FONT: Record<string, string> = { sans: "Inter,Arial,sans-serif", serif: "Georgia,serif", mono: "ui-monospace,monospace" };

/** Serializes a validated FaceSpec to inline-only, byte-stable SVG. */
export function renderFaceSvg(spec: FaceSpec, width = 1000, height = 1000): string {
  const gradients: string[] = [];
  let gradientIndex = 0;
  const fill = (value: FaceFill): string => {
    if (typeof value === "string") return value;
    const id = `g${gradientIndex++}`;
    gradients.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${value.x1}" y1="${value.y1}" x2="${value.x2}" y2="${value.y2}">${value.stops.map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}"/>`).join("")}</linearGradient>`);
    return `url(#${id})`;
  };
  const body = [`<rect width="1000" height="1000" fill="${fill(spec.background)}"/>`, ...spec.elements.map((element) => svgElement(element, fill))].join("");
  const defs = gradients.length === 0 ? "" : `<defs>${gradients.join("")}</defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeDimension(width)}" height="${safeDimension(height)}" viewBox="0 0 1000 1000">${defs}${body}</svg>`;
}

function svgElement(element: FaceElement, fill: (value: FaceFill) => string): string {
  const painted = "fill" in element || "stroke" in element
    ? `${"fill" in element && element.fill !== undefined ? ` fill="${fill(element.fill)}"` : element.type === "line" ? " fill=\"none\"" : " fill=\"none\""}${"stroke" in element && element.stroke !== undefined ? ` stroke="${element.stroke}"` : ""}${"strokeWidth" in element && element.strokeWidth !== undefined ? ` stroke-width="${element.strokeWidth}"` : ""}${"opacity" in element && element.opacity !== undefined ? ` opacity="${element.opacity}"` : ""}`
    : "";
  switch (element.type) {
    case "rect": return `<rect x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}"${element.r === undefined ? "" : ` rx="${element.r}"`}${painted}/>`;
    case "circle": return `<circle cx="${element.cx}" cy="${element.cy}" r="${element.r}"${painted}/>`;
    case "ellipse": return `<ellipse cx="${element.cx}" cy="${element.cy}" rx="${element.rx}" ry="${element.ry}"${painted}/>`;
    case "polygon": return `<polygon points="${element.points.map((point) => `${point.x},${point.y}`).join(" ")}"${painted}/>`;
    case "path": return `<path d="${escapeAttribute(element.d)}"${painted}/>`;
    case "line": return `<line x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}"${painted}/>`;
    case "text": return `<text x="${element.x}" y="${element.y}" font-family="${FONT[element.font]}" font-size="${element.size}" font-weight="${element.weight ?? 400}" text-anchor="${textAnchor(element.align)}"${element.rotation === undefined ? "" : ` transform="rotate(${element.rotation} ${element.x} ${element.y})"`}${painted}>${escapeText(element.text)}</text>`;
    case "icon": return svgIcon(element.name, element.x, element.y, element.size, element.rotation, painted);
    case "group": {
      const transforms: string[] = [];
      if (element.translate !== undefined) transforms.push(`translate(${element.translate.x} ${element.translate.y})`);
      if (element.rotate !== undefined) transforms.push(`rotate(${element.rotate})`);
      if (element.scale !== undefined) transforms.push(`scale(${element.scale.x} ${element.scale.y})`);
      const attributes = `${transforms.length === 0 ? "" : ` transform="${transforms.join(" ")}"`}${element.opacity === undefined ? "" : ` opacity="${element.opacity}"`}`;
      return `<g${attributes}>${element.elements.map((child) => svgElement(child, fill)).join("")}</g>`;
    }
  }
}

function svgIcon(name: FaceIconName, x: number, y: number, size: number, rotation: number | undefined, painted: string): string {
  const transform = `translate(${x - size / 2} ${y - size / 2}) scale(${size / 1000})${rotation === undefined ? "" : ` rotate(${rotation} 500 500)`}`;
  if (name.startsWith("pip-")) {
    return `<g transform="${transform}"${painted}>${PIP_POINTS[name as `pip-${number}`]!.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="90"/>`).join("")}</g>`;
  }
  return `<path d="${ICON_PATHS[name as keyof typeof ICON_PATHS]}" transform="${transform}"${painted}/>`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function textAnchor(align: "left" | "center" | "right" | undefined): "start" | "middle" | "end" {
  return align === "center" ? "middle" : align === "right" ? "end" : "start";
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function safeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 && value <= 8192 ? value : 1000;
}
