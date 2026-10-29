/** Shared geometry keeps the same silhouette, dimensions and hit target in both renderers. */
export interface PieceGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly uvs: Float32Array;
}

function result(positions: number[], normals: number[], indices: number[], uvs: number[]): PieceGeometry {
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices), uvs: new Float32Array(uvs) };
}

/** A rounded cuboid with analytic normals, rather than a sharp cube with painted corners. */
export function roundedBoxGeometry(width: number, height: number, depth: number, requestedRadius = 0.1): PieceGeometry {
  const half = [width / 2, height / 2, depth / 2];
  const radius = Math.min(requestedRadius, ...half) * 0.999;
  const positions: number[] = []; const normals: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  const faces = [
    { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], a: depth, b: height },
    { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], a: depth, b: height },
    { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], a: width, b: depth },
    { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], a: width, b: depth },
    { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], a: width, b: height },
    { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], a: width, b: height },
  ];
  const coordinates = (size: number) => {
    const h = size / 2;
    return [-h, -h + radius * 0.25, -h + radius * 0.55, -h + radius, h - radius, h - radius * 0.55, h - radius * 0.25, h];
  };
  for (const face of faces) {
    const xs = coordinates(face.a); const ys = coordinates(face.b); const start = positions.length / 3;
    for (const [row, y] of ys.entries()) for (const [column, x] of xs.entries()) {
      const point = face.normal.map((n, axis) => n * half[axis]! + face.u[axis]! * x + face.v[axis]! * y);
      const center = point.map((p, axis) => Math.max(-half[axis]! + radius, Math.min(half[axis]! - radius, p)));
      const delta = point.map((p, axis) => p - center[axis]!); const length = Math.hypot(...delta);
      for (let axis = 0; axis < 3; axis++) { const normal = delta[axis]! / length; normals.push(normal); positions.push(center[axis]! + normal * radius); }
      uvs.push(column / (xs.length - 1), row / (ys.length - 1));
    }
    for (let row = 0; row < ys.length - 1; row++) for (let column = 0; column < xs.length - 1; column++) {
      const a = start + row * xs.length + column; const b = a + 1; const c = a + xs.length; const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return result(positions, normals, indices, uvs);
}

/** Thin stock with rounded plan-view corners and a small bevel along its paper edge. */
export function roundedCardGeometry(width: number, height: number, depth: number, radius = 0.075): PieceGeometry {
  const positions: number[] = []; const normals: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  const outline: Array<readonly [number, number, number, number]> = [];
  const bevel = Math.min(0.008, height / 5);
  for (let corner = 0; corner < 4; corner++) {
    const angle = corner * Math.PI / 2;
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
    const cz = (corner < 2 ? 1 : -1) * (depth / 2 - radius);
    for (let step = 0; step <= 6; step++) {
      const a = angle + step * Math.PI / 12; const nx = Math.cos(a); const nz = Math.sin(a);
      outline.push([cx + radius * nx, cz + radius * nz, nx, nz]);
    }
  }
  const rings = [
    { y: height / 2, inset: bevel, ny: 1, side: 0 },
    { y: height / 2 - bevel, inset: 0, ny: 0.65, side: 0.76 },
    { y: -height / 2 + bevel, inset: 0, ny: -0.65, side: 0.76 },
    { y: -height / 2, inset: bevel, ny: -1, side: 0 },
  ];
  for (const ring of rings) for (const [x, z, nx, nz] of outline) {
    positions.push(x - nx * ring.inset, ring.y, z - nz * ring.inset);
    normals.push(nx * ring.side, ring.ny, nz * ring.side); uvs.push(x / width + 0.5, z / depth + 0.5);
  }
  const count = outline.length;
  for (let ring = 0; ring < rings.length - 1; ring++) for (let point = 0; point < count; point++) {
    const next = (point + 1) % count; const a = ring * count + point; const b = a + count;
    const c = ring * count + next; const d = c + count; indices.push(a, c, b, b, c, d);
  }
  const top = positions.length / 3; positions.push(0, height / 2, 0); normals.push(0, 1, 0); uvs.push(0.5, 0.5);
  const bottom = positions.length / 3; positions.push(0, -height / 2, 0); normals.push(0, -1, 0); uvs.push(0.5, 0.5);
  for (let point = 0; point < count; point++) {
    const next = (point + 1) % count; indices.push(top, next, point, bottom, 3 * count + point, 3 * count + next);
  }
  return result(positions, normals, indices, uvs);
}
