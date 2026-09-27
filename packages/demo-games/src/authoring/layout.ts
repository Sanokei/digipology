import type { Vector3 } from "digipology-kernel";

export interface GridCell {
  readonly row: number;
  readonly column: number;
  readonly position: Vector3;
}

export function hexAxialToWorld(q: number, r: number, size = 1, y = 0): Vector3 {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y,
    z: size * 1.5 * r,
  };
}

export function squareGrid(
  rows: number,
  columns: number,
  spacing = 1,
  origin: Vector3 = { x: 0, y: 0, z: 0 },
): GridCell[] {
  if (!Number.isSafeInteger(rows) || rows < 1 || !Number.isSafeInteger(columns) || columns < 1) {
    throw new RangeError("Grid dimensions must be positive integers");
  }
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        row,
        column,
        position: {
          x: origin.x + (column - (columns - 1) / 2) * spacing,
          y: origin.y,
          z: origin.z + (row - (rows - 1) / 2) * spacing,
        },
      });
    }
  }
  return cells;
}

export function ringLayout(count: number, radius: number, y = 0): Vector3[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Seat count must be a positive integer");
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError("Ring radius must be positive and finite");
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
  });
}
