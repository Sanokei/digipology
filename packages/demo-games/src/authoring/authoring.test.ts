import { describe, expect, test } from "bun:test";
import { hexAxialToWorld, hexTopology, ringLayout, squareGrid, standard52CardDeck } from "./index";

describe("builtin authoring layouts", () => {
  test("maps axial hex coordinates into pointy-top world coordinates", () => {
    expect(hexAxialToWorld(0, 0, 2)).toEqual({ x: 0, y: 0, z: 0 });
    expect(hexAxialToWorld(1, 0, 2)).toEqual({ x: 2 * Math.sqrt(3), y: 0, z: 0 });
    expect(hexAxialToWorld(0, 1, 2)).toEqual({ x: Math.sqrt(3), y: 0, z: 3 });
  });

  test("deduplicates shared hex vertices and edges with stable adjacency", () => {
    const topology = hexTopology([[0, 0], [1, 0]]);
    expect(topology.tiles).toHaveLength(2);
    expect(topology.vertices).toHaveLength(10);
    expect(topology.edges).toHaveLength(11);
    expect(topology.edges.filter((edge) => edge.tileIds.length === 2)).toHaveLength(1);
    expect(topology.vertices.every((vertex) => vertex.neighborIds.length >= 2)).toBeTrue();
  });

  test("centers square grids deterministically in row-major order", () => {
    expect(squareGrid(2, 3, 2)).toEqual([
      { row: 0, column: 0, position: { x: -2, y: 0, z: -1 } },
      { row: 0, column: 1, position: { x: 0, y: 0, z: -1 } },
      { row: 0, column: 2, position: { x: 2, y: 0, z: -1 } },
      { row: 1, column: 0, position: { x: -2, y: 0, z: 1 } },
      { row: 1, column: 1, position: { x: 0, y: 0, z: 1 } },
      { row: 1, column: 2, position: { x: 2, y: 0, z: 1 } },
    ]);
  });

  test("lays seats around a ring and generates a unique standard deck", () => {
    const ring = ringLayout(4, 5);
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual({ x: Math.cos(-Math.PI / 2) * 5, y: 0, z: -5 });
    const cards = standard52CardDeck();
    expect(cards).toHaveLength(52);
    expect(new Set(cards.map((card) => card.id)).size).toBe(52);
    expect(cards[0]).toEqual({
      id: "card_clubs_ace",
      definitionId: "standard_clubs_ace",
      suit: "clubs",
      rank: "ace",
    });
    expect(cards.at(-1)?.id).toBe("card_spades_king");
  });
});
