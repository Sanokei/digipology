export const FACE_FONTS = ["sans", "serif", "mono"] as const;
export const FACE_ICONS = [
  "wheat", "brick", "ore", "wool", "lumber", "desert", "coin", "crown",
  "sword", "shield", "anchor", "star", "skull", "eye", "scroll", "heart",
  "tower", "horse", "bishop-mitre", "king-cross", "queen-crown", "pawn",
  "flag", "hand", "gavel", "road", "house", "city", "ship",
  "pip-1", "pip-2", "pip-3", "pip-4", "pip-5", "pip-6",
] as const;

export type FaceFont = typeof FACE_FONTS[number];
export type FaceIconName = typeof FACE_ICONS[number];
export type FaceColor = `#${string}`;

export interface LinearGradientFill {
  type: "linear-gradient";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: Array<{ offset: number; color: FaceColor }>;
}

export type FaceFill = FaceColor | LinearGradientFill;

interface PaintedElement {
  fill?: FaceFill;
  stroke?: FaceColor;
  strokeWidth?: number;
  opacity?: number;
}

export interface FaceRect extends PaintedElement { type: "rect"; x: number; y: number; w: number; h: number; r?: number }
export interface FaceCircle extends PaintedElement { type: "circle"; cx: number; cy: number; r: number }
export interface FaceEllipse extends PaintedElement { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
export interface FacePolygon extends PaintedElement { type: "polygon"; points: Array<{ x: number; y: number }> }
export interface FacePath extends PaintedElement { type: "path"; d: string }
export interface FaceLine extends Omit<PaintedElement, "fill"> { type: "line"; x1: number; y1: number; x2: number; y2: number }
export interface FaceText extends Omit<PaintedElement, "strokeWidth"> {
  type: "text"; x: number; y: number; text: string; font: FaceFont; size: number;
  weight?: 400 | 600 | 700 | 800; align?: "left" | "center" | "right"; rotation?: number;
}
export interface FaceIcon extends PaintedElement { type: "icon"; name: FaceIconName; x: number; y: number; size: number; rotation?: number }
export interface FaceGroup { type: "group"; translate?: { x: number; y: number }; rotate?: number; scale?: { x: number; y: number }; opacity?: number; elements: FaceElement[] }

export type FaceElement = FaceRect | FaceCircle | FaceEllipse | FacePolygon | FacePath | FaceLine | FaceText | FaceIcon | FaceGroup;

export interface FaceSpec {
  background: FaceFill;
  elements: FaceElement[];
}

export interface FaceValidationError {
  path: string;
  code: "type" | "unknown_key" | "range" | "limit" | "format";
  message: string;
}

export type FaceValidationResult =
  | { ok: true; value: FaceSpec; errors: [] }
  | { ok: false; errors: FaceValidationError[] };

export interface FaceValidationOptions { maxElements?: number }
