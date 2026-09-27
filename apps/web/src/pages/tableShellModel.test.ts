import { describe, expect, test } from "bun:test";
import { createInitialState } from "digipology-kernel";
import { currentTurnPlayerId, handCountsByPlayer, seatPickerSeats, tableMenuEntries } from "./tableShellModel";

describe("table shell model", () => {
  test("gates host menu commands while keeping the Objects integration slot", () => {
    expect(tableMenuEntries(false).map((item) => item.id)).toEqual(["players", "chat", "rules", "log", "objects", "settings", "help"]);
    expect(tableMenuEntries(true).map((item) => item.id)).toEqual(["players", "chat", "rules", "log", "save", "game", "objects", "settings", "help"]);
  });

  test("arranges seats, occupancy, hands, and Lua turns", () => {
    const state = createInitialState({ releaseId: "release", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 } });
    state.players = { alice: { id: "alice" }, bob: { id: "bob" } };
    state.seats = {
      red: { id: "red", playerId: "alice", handId: "hand_red" },
      blue: { id: "blue", playerId: "bob", handId: "hand_blue" },
    };
    state.entities = {
      hand_red: { id: "hand_red", components: { container: { items: ["a", "b"], capacity: null, ordering: "ordered", visibility: "owner" }, hand: { owner: "red", canonicalOrder: true } } },
      hand_blue: { id: "hand_blue", components: { container: { items: [], capacity: null, ordering: "ordered", visibility: "owner" }, hand: { owner: "blue", canonicalOrder: true } } },
    };
    state.scriptState = { __stdlib: { turns: { active: true, order: ["bob", "alice"], index: 2 } } };
    const players = [
      { playerId: "alice", displayName: "Alice", seatId: "red", connected: true },
      { playerId: "bob", displayName: "Bob", seatId: "blue", connected: true },
    ];
    expect(seatPickerSeats(state, players, "alice").find((seat) => seat.id === "red")).toMatchObject({ selected: true, available: true });
    expect(handCountsByPlayer(state).get("alice")).toBe(2);
    expect(currentTurnPlayerId(state)).toBe("alice");
  });
});
