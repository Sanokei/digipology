import type { Vector3 } from "digipology-kernel";

export interface GridCell {
  readonly row: number;
  readonly column: number;
  readonly position: Vector3;
}

export interface HexTile extends GridCell {
  readonly q: number;
  readonly r: number;
  readonly id: string;
  readonly vertexIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface HexVertex {
  readonly id: string;
  readonly position: Vector3;
  readonly tileIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly neighborIds: readonly string[];
}

export interface HexEdge {
  readonly id: string;
  readonly position: Vector3;
  readonly vertexIds: readonly [string, string];
  readonly tileIds: readonly string[];
  readonly rotationY: number;
}

export interface HexTopology {
  readonly tiles: readonly HexTile[];
  readonly vertices: readonly HexVertex[];
  readonly edges: readonly HexEdge[];
}

export function hexAxialToWorld(q: number, r: number, size = 1, y = 0): Vector3 {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y,
    z: size * 1.5 * r,
  };
}

/**
 * Builds stable pointy-top tile, vertex, and edge identities for an authored
 * island. Integer lattice keys avoid floating-point equality as topology input.
 */
export function hexTopology(
  coordinates: ReadonlyArray<readonly [q: number, r: number]>,
  size = 1,
  y = 0,
): HexTopology {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError("Hex size must be positive and finite");
  const coordinateKeys = new Set<string>();
  const ordered = [...coordinates].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  for (const [q, r] of ordered) {
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) throw new TypeError("Hex coordinates must be safe integers");
    const key = `${q},${r}`;
    if (coordinateKeys.has(key)) throw new TypeError(`Duplicate hex coordinate ${key}`);
    coordinateKeys.add(key);
  }

  type MutableVertex = { id: string; position: Vector3; tileIds: string[]; edgeKeys: string[] };
  type MutableEdge = { key: string; vertexKeys: [string, string]; tileIds: string[] };
  const vertexByKey = new Map<string, MutableVertex>();
  const edgeByKey = new Map<string, MutableEdge>();
  const tileDrafts: Array<{ id: string; q: number; r: number; position: Vector3; vertexKeys: string[]; edgeKeys: string[] }> = [];

  for (const [q, r] of ordered) {
    const id = `hex_${q < 0 ? "m" : "p"}${Math.abs(q)}_${r < 0 ? "m" : "p"}${Math.abs(r)}`;
    const position = hexAxialToWorld(q, r, size, y);
    const vertexKeys: string[] = [];
    for (let corner = 0; corner < 6; corner += 1) {
      // A vertex shared by three pointy-top axial cells has an exact integer
      // key in this doubled lattice.
      const key = `${2 * q + r + [1, 1, 0, -1, -1, 0][corner]!},${3 * r + [-1, 1, 2, 1, -1, -2][corner]!}`;
      vertexKeys.push(key);
      let vertex = vertexByKey.get(key);
      if (vertex === undefined) {
        const angle = Math.PI / 180 * (60 * corner - 30);
        vertex = {
          id: "",
          position: { x: position.x + size * Math.cos(angle), y, z: position.z + size * Math.sin(angle) },
          tileIds: [],
          edgeKeys: [],
        };
        vertexByKey.set(key, vertex);
      }
      vertex.tileIds.push(id);
    }
    const edgeKeys: string[] = [];
    for (let side = 0; side < 6; side += 1) {
      const pair = [vertexKeys[side]!, vertexKeys[(side + 1) % 6]!] as [string, string];
      pair.sort();
      const key = `${pair[0]}|${pair[1]}`;
      edgeKeys.push(key);
      let edge = edgeByKey.get(key);
      if (edge === undefined) {
        edge = { key, vertexKeys: pair, tileIds: [] };
        edgeByKey.set(key, edge);
      }
      edge.tileIds.push(id);
      vertexByKey.get(pair[0])!.edgeKeys.push(key);
      vertexByKey.get(pair[1])!.edgeKeys.push(key);
    }
    tileDrafts.push({ id, q, r, position, vertexKeys, edgeKeys });
  }

  const vertexKeys = [...vertexByKey.keys()].sort();
  const vertexId = new Map(vertexKeys.map((key, index) => [key, `vertex_${String(index + 1).padStart(3, "0")}`]));
  const edgeKeys = [...edgeByKey.keys()].sort();
  const edgeId = new Map(edgeKeys.map((key, index) => [key, `edge_${String(index + 1).padStart(3, "0")}`]));
  const vertices = vertexKeys.map((key): HexVertex => {
    const vertex = vertexByKey.get(key)!;
    const neighbors = new Set<string>();
    for (const edgeKey of vertex.edgeKeys) {
      for (const other of edgeByKey.get(edgeKey)!.vertexKeys) if (other !== key) neighbors.add(vertexId.get(other)!);
    }
    return {
      id: vertexId.get(key)!, position: vertex.position,
      tileIds: [...new Set(vertex.tileIds)].sort(),
      edgeIds: [...new Set(vertex.edgeKeys)].sort().map((value) => edgeId.get(value)!),
      neighborIds: [...neighbors].sort(),
    };
  });
  const edges = edgeKeys.map((key): HexEdge => {
    const edge = edgeByKey.get(key)!;
    const left = vertexByKey.get(edge.vertexKeys[0])!.position;
    const right = vertexByKey.get(edge.vertexKeys[1])!.position;
    return {
      id: edgeId.get(key)!,
      position: { x: (left.x + right.x) / 2, y, z: (left.z + right.z) / 2 },
      vertexIds: [vertexId.get(edge.vertexKeys[0])!, vertexId.get(edge.vertexKeys[1])!],
      tileIds: [...edge.tileIds].sort(),
      rotationY: Math.atan2(right.x - left.x, right.z - left.z),
    };
  });
  const tiles = tileDrafts.map((tile, index): HexTile => ({
    id: tile.id, q: tile.q, r: tile.r, row: index, column: 0, position: tile.position,
    vertexIds: tile.vertexKeys.map((key) => vertexId.get(key)!),
    edgeIds: tile.edgeKeys.map((key) => edgeId.get(key)!),
  }));
  return { tiles, vertices, edges };
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
