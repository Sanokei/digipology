import type { EntityRecord } from "digipology-kernel";
import { hasSpatialPresentation, piecePresentation } from "./piecePresentation";

export const DEFAULT_CAMERA_RADIUS = 11.8;
export const MIN_CAMERA_RADIUS = 7.3;
export const MAX_CAMERA_RADIUS = 40;
export const TABLE_CAMERA_BETA = 0.92;
const FOV = 0.8;

export interface TablePieceBounds {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly top: number;
}

export interface TableCameraFrame {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

const DEFAULT_FRAME: TableCameraFrame = { x: 0, z: 0, radius: DEFAULT_CAMERA_RADIUS };

/** Bounds of the same physical mesh, using authored scale/rotation rather than spawn animation. */
export function pieceFramingBounds(entity: EntityRecord): TablePieceBounds | null {
  if (!hasSpatialPresentation(entity)) return null;
  const appearance = piecePresentation(entity);
  if (appearance.alpha <= 0) return null;
  const transform = entity.components.transform;
  const scale = transform?.scale ?? { x: 1, y: 1, z: 1 };
  const q = transform?.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
  const width = appearance.width * Math.abs(scale.x);
  const height = appearance.height * Math.abs(scale.y);
  const depth = appearance.depth * Math.abs(scale.z);
  const xx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const xy = 2 * (q.x * q.y - q.z * q.w);
  const xz = 2 * (q.x * q.z + q.y * q.w);
  const yx = 2 * (q.x * q.y + q.z * q.w);
  const yy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const yz = 2 * (q.y * q.z - q.x * q.w);
  const zx = 2 * (q.x * q.z - q.y * q.w);
  const zy = 2 * (q.y * q.z + q.x * q.w);
  const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return {
    x: transform?.position.x ?? 0,
    z: transform?.position.z ?? 0,
    width: Math.abs(xx) * width + Math.abs(xy) * height + Math.abs(xz) * depth,
    depth: Math.abs(zx) * width + Math.abs(zy) * height + Math.abs(zz) * depth,
    top: Math.max(transform?.position.y ?? 0, appearance.height / 2)
      + (Math.abs(yx) * width + Math.abs(yy) * height + Math.abs(yz) * depth) / 2,
  };
}

/** Wide screens retain the familiar table view. Narrow screens fit the actual visible pieces. */
export function tableCameraFrame(width: number, height: number, pieces: readonly TablePieceBounds[]): TableCameraFrame {
  if (width <= 0 || height <= 0 || width / height >= 0.7 || pieces.length === 0) return DEFAULT_FRAME;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let top = 0;
  for (const piece of pieces) {
    minX = Math.min(minX, piece.x - piece.width / 2); maxX = Math.max(maxX, piece.x + piece.width / 2);
    minZ = Math.min(minZ, piece.z - piece.depth / 2); maxZ = Math.max(maxZ, piece.z + piece.depth / 2);
    top = Math.max(top, piece.top);
  }
  const spanX = maxX - minX; const spanZ = maxZ - minZ;
  const tangent = Math.tan(FOV / 2); const aspect = width / height;
  const depthAllowance = spanZ * Math.sin(TABLE_CAMERA_BETA) / 2 + top * Math.cos(TABLE_CAMERA_BETA);
  const horizontal = (spanX + 0.9) / (2 * tangent * aspect);
  const vertical = (spanZ * Math.cos(TABLE_CAMERA_BETA) + top * Math.sin(TABLE_CAMERA_BETA) + 0.9) / (2 * tangent);
  return {
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
    radius: Math.min(MAX_CAMERA_RADIUS, Math.max(DEFAULT_CAMERA_RADIUS, horizontal + depthAllowance, vertical + depthAllowance)),
  };
}

/** The renderer may fit new pieces until a person takes control of the camera or a piece. */
export class TableFramingController {
  private manual = false;
  private applied = false;
  private frame: TableCameraFrame = DEFAULT_FRAME;

  get automatic(): boolean { return !this.manual; }
  get current(): TableCameraFrame { return this.frame; }

  hold(): void { this.manual = true; }
  reset(): void { this.manual = false; this.applied = false; this.frame = DEFAULT_FRAME; }

  update(width: number, height: number, pieces: readonly TablePieceBounds[]): TableCameraFrame | null {
    if (this.manual) return null;
    const next = tableCameraFrame(width, height, pieces);
    const changed = !this.applied || next.x !== this.frame.x || next.z !== this.frame.z || next.radius !== this.frame.radius;
    this.frame = next; this.applied = true;
    return changed ? next : null;
  }
}
