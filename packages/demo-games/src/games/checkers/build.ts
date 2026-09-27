import { canonicalStringify } from "digipology-canonical-json";
import type { FaceSpec } from "digipology-faces";
import {
  canonicalizeTransform,
  createInitialState,
  type CanonicalGameState,
  type EntityComponents,
  type EntityRecord,
  type TransformComponent,
} from "digipology-kernel";
import { squareGrid, type BuiltinReleaseBuilder, type BuiltinReleaseSource } from "../../authoring";

const RELEASE_1_ID = "builtin_tabletop_classics_checkers_1";
const RELEASE_2_ID = "builtin_tabletop_classics_checkers_2";

function transform(x: number, y: number, z: number, scale = { x: 1, y: 1, z: 1 }): TransformComponent {
  return canonicalizeTransform({
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale,
  });
}

function entity(id: string, components: EntityComponents): EntityRecord {
  return { id, components };
}

interface CheckerPiece {
  readonly id: string;
  readonly side: "red" | "black";
  readonly seatId: "seat_1" | "seat_2";
  readonly squareId: string;
  readonly row: number;
  readonly column: number;
}

function checkerPieces(): CheckerPiece[] {
  const pieces: CheckerPiece[] = [];
  let red = 0;
  let black = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if ((row + column) % 2 !== 1) continue;
      if (row < 3) {
        black += 1;
        pieces.push({
          id: `checker_seat_2_${String(black).padStart(2, "0")}`,
          side: "black",
          seatId: "seat_2",
          squareId: `square_${row}_${column}`,
          row,
          column,
        });
      } else if (row > 4) {
        red += 1;
        pieces.push({
          id: `checker_seat_1_${String(red).padStart(2, "0")}`,
          side: "red",
          seatId: "seat_1",
          squareId: `square_${row}_${column}`,
          row,
          column,
        });
      }
    }
  }
  return pieces;
}

function checkersState(pieces: readonly CheckerPiece[], releaseId: string): CanonicalGameState {
  const cells = squareGrid(8, 8, 1.05);
  const occupied = new Map(pieces.map((piece) => [piece.squareId, piece.id]));
  const positions = new Map(cells.map((cell) => [`square_${cell.row}_${cell.column}`, cell.position]));
  const entities: CanonicalGameState["entities"] = {
    board: entity("board", {
      transform: transform(0, 0, 0, { x: 8.7, y: 0.12, z: 8.7 }),
      lockable: { locked: true },
      tags: { values: ["board", "checkers"] },
      appearance: { definitionId: "checkerboard" },
    }),
  };
  for (const cell of cells) {
    const id = `square_${cell.row}_${cell.column}`;
    const attached = occupied.get(id);
    entities[id] = entity(id, {
      transform: transform(cell.position.x, 0.12, cell.position.z),
      "snap-point": {
        radius: 0.48,
        capacity: 1,
        tags: ["checker"],
        alignment: null,
        attached: attached === undefined ? [] : [attached],
      },
      appearance: { definitionId: (cell.row + cell.column) % 2 === 0 ? "light_square" : "dark_square" },
    });
  }
  for (const piece of pieces) {
    const position = positions.get(piece.squareId);
    if (position === undefined) throw new Error(`Missing checker square ${piece.squareId}`);
    entities[piece.id] = entity(piece.id, {
      transform: transform(position.x, 0.3, position.z, { x: 0.76, y: 0.24, z: 0.76 }),
      grabbable: { enabled: true, heldBy: null },
      flippable: { flipped: false },
      tags: { values: ["checker", piece.side, "man"] },
      appearance: { definitionId: `${piece.side}_man`, seat: piece.seatId },
    });
  }
  return createInitialState({
    releaseId,
    rng: { algorithm: "sfc32-v1", state: [672143281, 287619045, 3901287781, 1189473206], draws: 0 },
    settings: { sandbox: true },
    seats: {
      seat_1: { id: "seat_1", playerId: null },
      seat_2: { id: "seat_2", playerId: null },
    },
    entities,
  });
}

function checkerboardFace(): FaceSpec {
  return {
    background: "#e8d7b5",
    elements: squareGrid(8, 8, 125).map(({ row, column }) => ({
      type: "rect" as const,
      x: column * 125,
      y: row * 125,
      w: 125,
      h: 125,
      fill: (row + column) % 2 === 0 ? "#e8d7b5" : "#6f4327",
    })),
  };
}

function manFace(color: `#${string}`, crowned: boolean): FaceSpec {
  return {
    background: color,
    elements: crowned ? [{
      type: "icon",
      name: "crown",
      x: 500,
      y: 500,
      size: 560,
      fill: "#f6d365",
      stroke: "#3a2718",
      strokeWidth: 28,
    }] : [],
  };
}

function buildRelease(
  releaseId: string,
  releaseNumber: number,
  definitions: NonNullable<BuiltinReleaseSource["definitions"]>,
): BuiltinReleaseSource {
  const pieces = checkerPieces();
  const squareIds = squareGrid(8, 8).map(({ row, column }) => `square_${row}_${column}`);
  const runtime = canonicalStringify({
    formatVersion: 1,
    releaseId,
    board: { rows: 8, columns: 8, squareIds },
    pieces: pieces.map(({ id, side, seatId, squareId }) => ({ id, side, seatId, squareId })),
    rules: { crowningAction: "entity.flip", interaction: "sandbox" },
  });
  return {
    formatVersion: 1,
    gameId: "builtin_tabletop_classics_checkers",
    releaseId,
    releaseNumber,
    kernelVersion: 1,
    luaApiVersion: 1,
    luaStdlibVersion: 1,
    networkProtocolVersion: 1,
    interactionMode: "sandbox",
    minPlayers: 2,
    maxPlayers: 2,
    files: [{ path: "runtime/game.json", content: runtime }],
    definitions,
    refs: { board: "board" },
    initialState: checkersState(pieces, releaseId),
  };
}

export function buildCheckersRelease1(): BuiltinReleaseSource {
  return buildRelease(RELEASE_1_ID, 1, {
    checkerboard: { label: "Checkers board", color: "#6f4327" },
    light_square: { label: "Light square", color: "#e8d7b5" },
    dark_square: { label: "Dark square", color: "#6f4327" },
    red_man: { label: "Red man", color: "#b73535" },
    black_man: { label: "Black man", color: "#24242a" },
  });
}

export function buildCheckersRelease(): BuiltinReleaseSource {
  return buildRelease(RELEASE_2_ID, 2, {
    checkerboard: {
      shape: "board",
      size: { w: 8.7, d: 8.7, h: 0.12 },
      color: "#6f4327",
      label: "Checkers board",
      face: checkerboardFace(),
    },
    light_square: { shape: "box", size: { w: 1.05, d: 1.05, h: 0.05 }, color: "#e8d7b5" },
    dark_square: { shape: "box", size: { w: 1.05, d: 1.05, h: 0.05 }, color: "#6f4327" },
    red_man: {
      shape: "disc",
      size: { w: 0.8, d: 0.8, h: 0.18 },
      seatTint: true,
      label: "Man",
      backLabel: "King",
      face: manFace("#f2f2ed", false),
      back: manFace("#f2f2ed", true),
    },
    black_man: {
      shape: "disc",
      size: { w: 0.8, d: 0.8, h: 0.18 },
      seatTint: true,
      label: "Man",
      backLabel: "King",
      face: manFace("#d94b4b", false),
      back: manFace("#d94b4b", true),
    },
  });
}

export const BUILTIN_RELEASE_BUILDER = {
  slug: "checkers",
  releaseNumber: 2,
  build: buildCheckersRelease,
} satisfies BuiltinReleaseBuilder;
