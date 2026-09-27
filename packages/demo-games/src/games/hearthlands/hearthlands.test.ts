import { describe, expect, test } from "bun:test";
import {
  applyOrderedWithScripts,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type OrderedActionInput,
  type TransformComponent,
} from "digipology-kernel";
import { materializeBuiltinRelease } from "../../authoring";
import { createBuiltinCreatorRuntime } from "../../test-support";
import { buildHearthlandsRelease } from "./build";
import generatedRelease from "./release-1.generated";

async function act(
  state: CanonicalGameState,
  runtime: Awaited<ReturnType<typeof createBuiltinCreatorRuntime>>,
  actor: OrderedActionInput["actor"],
  type: string,
  payload: unknown,
): Promise<CanonicalGameState> {
  const result = await applyOrderedWithScripts(state, {
    sequence: state.sequence + 1,
    actionId: `hearthlands_${state.sequence + 1}`,
    actor,
    action: { type, payload },
  }, { runtime, maxCommands: 1_024 });
  expect(result.rejection).toBeUndefined();
  return result.state;
}

async function startedGame(playerCount = 3): Promise<{ state: CanonicalGameState; runtime: Awaited<ReturnType<typeof createBuiltinCreatorRuntime>> }> {
  let state = loadSnapshot(generatedRelease.initialSnapshot);
  const runtime = await createBuiltinCreatorRuntime(generatedRelease.releaseId);
  for (const [index, playerId] of ["alice", "bob", "carol", "dara", "elio", "farah"].slice(0, playerCount).entries()) {
    state.players[playerId] = { id: playerId, name: playerId };
    state.seats[`seat_${index + 1}`]!.playerId = playerId;
  }
  state = await act(state, runtime, { type: "system" }, "system.game_start", { settings: { targetScore: 10, expandedAtPlayers: 5 } });
  return { state, runtime };
}

async function scriptedWin(): Promise<CanonicalGameState> {
  const { state: started, runtime } = await startedGame();
  try {
    let state = structuredClone(started);
    const scriptState = state.scriptState as Record<string, unknown>;
    (scriptState.monuments as Record<string, number>).alice = 9;
    const vertexId = (scriptState.vertex_ids as string[])[0]!;
    const target = state.entities[vertexId]!.components.transform!;
    const pieceId = "homestead_seat_1_01";
    state = await act(state, runtime, { type: "player", playerId: "alice" }, "entity.grab", { entityId: pieceId });
    const piece = state.entities[pieceId]!.components.transform!;
    const drop: TransformComponent = { ...piece, position: { ...target.position, y: piece.position.y } };
    state = await act(state, runtime, { type: "player", playerId: "alice" }, "entity.drop", { entityId: pieceId, transform: drop });
    return state;
  } finally { runtime.close(); }
}

describe("Hearthlands", () => {
  test("matches its generated release and loads every authored object", () => {
    expect(materializeBuiltinRelease(buildHearthlandsRelease())).toEqual(generatedRelease);
    const state = loadSnapshot(generatedRelease.initialSnapshot);
    expect(Object.values(state.entities).filter((value) => value.components.card?.definitionId.startsWith("terrain_"))).toHaveLength(30);
    expect(Object.values(state.entities).filter((value) => value.components.card?.definitionId.startsWith("chronicle_"))).toHaveLength(25);
    expect(Object.values(state.entities).filter((value) => value.components.appearance?.definitionId === "trail")).toHaveLength(90);
  });

  test("deterministically generates a legal 19-hex opening map", async () => {
    const first = await startedGame();
    const second = await startedGame();
    try {
      expect(snapshot(first.state).stateHash).toBe(snapshot(second.state).stateHash);
      const script = first.state.scriptState as Record<string, unknown>;
      expect(script.tile_ids).toHaveLength(19);
      const numbers = script.numbers as Record<string, number>;
      const terrain = script.terrain as Record<string, string>;
      expect(Object.keys(numbers)).toHaveLength(18);
      expect(Object.values(terrain).filter((value) => value === "wasteland")).toHaveLength(1);
      const runtime = JSON.parse(generatedRelease.files.find((file) => file.path === "runtime/game.json")!.content) as {
        tiles: Record<string, { neighborIds: string[] }>;
      };
      for (const [tile, value] of Object.entries(numbers)) {
        if (value !== 6 && value !== 8) continue;
        for (const neighbor of runtime.tiles[tile]!.neighborIds) expect([6, 8]).not.toContain(numbers[neighbor]);
      }
    } finally { first.runtime.close(); second.runtime.close(); }
  }, 20_000);

  test("a physical legal placement reaches scripted win detection with a stable hash", async () => {
    const first = await scriptedWin();
    const second = await scriptedWin();
    expect(first).toEqual(second);
    expect((first.scriptState as Record<string, unknown>).winner_id).toBe("alice");
    expect((first.scriptState as Record<string, unknown>).phase).toBe("game_over");
    expect(snapshot(first).stateHash).toBe("sha256:78ab41fe6bdc0db12e32535f15e7847b33aff6f231e882495c992e7c2a6ee6e0");
  }, 20_000);

  test("opens the deterministic 30-hex island for five players", async () => {
    const game = await startedGame(5);
    try {
      const script = game.state.scriptState as Record<string, unknown>;
      expect(script.tile_ids).toHaveLength(30);
      expect(Object.keys(script.numbers as Record<string, number>)).toHaveLength(29);
      expect(Object.values(script.terrain as Record<string, string>).filter((value) => value === "wasteland")).toHaveLength(1);
    } finally { game.runtime.close(); }
  }, 20_000);
});
