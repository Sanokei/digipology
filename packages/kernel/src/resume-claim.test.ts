import { expect, test } from "bun:test";
import { applyOrdered, applyOrderedWithScripts, createInitialState, snapshot, loadSnapshot, type CanonicalGameState, type OrderedActionInput, type ScriptRuntime } from "./index";

function saved() {
  return createInitialState({ releaseId: "pending-test", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    players: { alice: { id: "alice" }, bob: { id: "bob", name: "Saved Bob", color: "blue" } },
    seats: { seat_2: { id: "seat_2", playerId: "alice" }, seat_10: { id: "seat_10", playerId: "bob" } },
    prompts: { bid: { id: "bid", kind: "confirm", playerId: "bob", title: "Bid?", status: "open" } },
    entities: { hand: { id: "hand", components: { hand: { owner: "bob", canonicalOrder: true },
      container: { items: [], capacity: null, ordering: "ordered", visibility: "owner:bob" } } } },
  });
}
function frame(state: CanonicalGameState, type: string, payload: unknown, actor: OrderedActionInput["actor"] = { type: "system" }): OrderedActionInput {
  return { sequence: state.sequence + 1, actionId: `f${state.sequence + 1}`, actor, action: { type, payload } };
}
function resume(state = saved()) {
  const result = applyOrdered(state, frame(state, "system.game_resumed", { preservePendingSeats: true, roster: [{ playerId: "host", seatId: "seat_2", previousPlayerId: "alice" }] }));
  expect(result.rejection).toBeUndefined();
  return result.state;
}
const claim = { playerId: "guest", name: "Guest", seatId: "seat_10", previousPlayerId: "bob" };
function gameplay(state: CanonicalGameState) { return snapshot({ ...state, sequence: 0 }).stateHash; }

test("sparse pending seat survives snapshot and atomic claim restores identity, prompt and ownership", () => {
  const pending = loadSnapshot(snapshot(resume()));
  expect(Object.keys(pending.players)).toEqual(["host"]);
  expect(pending.prompts.bid).toBeUndefined();
  const result = applyOrdered(pending, frame(pending, "system.seat_claim", claim));
  expect(result.rejection).toBeUndefined();
  expect(result.state.players.guest).toEqual({ id: "guest", name: "Guest", color: "blue" });
  expect(result.state.seats.seat_10?.playerId).toBe("guest");
  expect(result.state.prompts.bid?.playerId).toBe("guest");
  expect(result.state.entities.hand?.components.hand?.owner).toBe("guest");
  expect(result.state.entities.hand?.components.container?.visibility).toBe("owner:guest");
  expect(result.events.map((event) => event.type)).toEqual(["seat.claimed"]);
  expect(loadSnapshot(snapshot(result.state))).toEqual(result.state);
});

test("claims reject wrong identity/seat, occupied identity, player/script authorization and duplicates atomically", () => {
  const pending = resume();
  const valid = applyOrdered(pending, frame(pending, "system.seat_claim", claim));
  expect(valid.rejection).toBeUndefined(); // Ensure unknown-action rejection cannot satisfy this test.
  for (const [payload, actor] of [
    [{ ...claim, previousPlayerId: "alice" }, { type: "system" }],
    [{ ...claim, seatId: "seat_2" }, { type: "system" }],
    [{ ...claim, playerId: "host" }, { type: "system" }],
    [claim, { type: "player", playerId: "host" }],
    [claim, { type: "script", scriptId: "rules" }],
  ] as const) {
    const result = applyOrdered(pending, frame(pending, "system.seat_claim", payload, actor));
    expect(result.rejection).toBeDefined();
    expect(result.state.sequence).toBe(pending.sequence + 1);
    expect(gameplay(result.state)).toBe(gameplay(pending));
  }
  const duplicate = applyOrdered(valid.state, frame(valid.state, "system.seat_claim", claim));
  expect(duplicate.rejection).toBeDefined();
  expect(gameplay(duplicate.state)).toBe(gameplay(valid.state));
});

test("save/resume again while a seat is pending preserves its claim", () => {
  const pending = loadSnapshot(snapshot({ ...resume(), sequence: 0 }));
  const again = applyOrdered(pending, frame(pending, "system.game_resumed", { preservePendingSeats: true, roster: [{ playerId: "host2", seatId: "seat_2", previousPlayerId: "host" }] }));
  expect(again.rejection).toBeUndefined();
  const result = applyOrdered(again.state, frame(again.state, "system.seat_claim", claim));
  expect(result.rejection).toBeUndefined();
  expect(result.state.prompts.bid?.playerId).toBe("guest");
  expect(Object.keys(result.state.players).sort()).toEqual(["guest", "host2"]);
});

test("claim callback failure rolls back escrow, roster, prompts, RNG and commands", async () => {
  const pending = resume();
  const runtime: ScriptRuntime = {
    bindings: () => [{ scriptId: "rules", bindingId: "rules", props: {} }],
    async invoke(request) {
      expect(request.functionName).toBe("on_seat_claimed");
      request.bridge.randomInt(1, 6);
      return { ok: false, error: { kind: "runtime", message: "claim failed" } };
    },
  };
  const result = await applyOrderedWithScripts(pending, frame(pending, "system.seat_claim", claim), { runtime });
  expect(result.rejection?.reason).toBe("claim failed");
  expect(gameplay(result.state)).toBe(gameplay(pending));
  expect(result.state.sequence).toBe(pending.sequence + 1);
});

test("pending gameplay and timer delivery stay paused indefinitely without consuming gameplay", () => {
  const pending = resume();
  for (const [type, payload, actor] of [
    ["prompt.respond", { promptId: "bid", response: true }, { type: "player", playerId: "host" }],
    ["system.timer_fire", { timerId: "tick" }, { type: "system" }],
    ["system.player_left", { playerId: "host" }, { type: "system" }],
  ] as const) {
    const result = applyOrdered(pending, frame(pending, type, payload, actor));
    expect(result.rejection?.reason).toBe("Saved seats must be claimed before gameplay resumes");
    expect(gameplay(result.state)).toBe(gameplay(pending));
    expect(result.state.sequence).toBe(pending.sequence + 1);
  }
  expect(() => applyOrdered(pending, { ...frame(pending, "system.timer_fire", {}), sequence: 999 })).toThrow("Expected ordered sequence");
});

test("pending identity, prompts and ownership are validated and hash-covered", () => {
  const pending = resume();
  const valid = snapshot(pending);
  const changed = loadSnapshot(valid);
  changed.pendingSeats!.seat_10!.player.name = "Changed";
  expect(snapshot(changed).stateHash).not.toBe(valid.stateHash);
  expect(() => loadSnapshot({ ...valid, state: changed })).toThrow();
  for (const mutate of [
    (state: CanonicalGameState) => { state.pendingSeats!.seat_10!.player.id = "host"; },
    (state: CanonicalGameState) => { state.seats.seat_10!.playerId = "host"; },
    (state: CanonicalGameState) => { state.pendingSeats!.seat_10!.prompts.bid!.playerId = "wrong"; },
    (state: CanonicalGameState) => { state.pendingSeats!.seat_10!.handIds = ["missing"]; },
    (state: CanonicalGameState) => { state.pendingSeats!.seat_10!.prompts.bid!.title = Number.NaN as unknown as string; },
  ]) {
    const malformed = loadSnapshot(valid);
    mutate(malformed);
    expect(() => snapshot(malformed)).toThrow();
  }
});

test("historical partial resume frames keep legacy removal semantics without the opt-in", () => {
  const initial = saved();
  const legacy = applyOrdered(initial, frame(initial, "system.game_resumed", {
    roster: [{ playerId: "host", seatId: "seat_2", previousPlayerId: "alice" }],
  }));
  expect(legacy.rejection).toBeUndefined();
  expect(legacy.state.pendingSeats).toBeUndefined();
  expect(legacy.state.prompts.bid).toBeUndefined();
  expect(legacy.events[0]?.data.resumeSeats).toBeUndefined();
  const rebased = { ...resume(), sequence: 0 };
  const wrong = applyOrdered(rebased, frame(rebased, "system.game_resumed", {
    roster: [{ playerId: "host2", seatId: "seat_2", previousPlayerId: "host" }],
  }));
  expect(wrong.rejection?.reason).toBe("Pending seats require an escrow-aware resume");
  expect(gameplay(wrong.state)).toBe(gameplay(rebased));
});

test("creator commands cannot synthesize a system claim and roll back the enclosing action", async () => {
  const pending = resume();
  const runtime: ScriptRuntime = {
    bindings: () => [{ scriptId: "hostile", bindingId: "hostile", props: {} }],
    async invoke(request) {
      request.bridge.queue({ type: "system.seat_claim", payload: claim });
      return { ok: true, handled: true };
    },
  };
  const result = await applyOrderedWithScripts(pending, frame(pending, "system.seat_claim", claim), { runtime });
  expect(result.rejection?.reason).toContain("does not allow source script");
  expect(gameplay(result.state)).toBe(gameplay(pending));
});

test("escrow-aware resume rejects seat identity swaps and reuse without altering legacy actions", () => {
  const initial = saved();
  for (const entry of [
    { playerId: "host", seatId: "seat_2", previousPlayerId: "bob" },
    { playerId: "host", seatId: "seat_2" },
    { playerId: "bob", seatId: "seat_2", previousPlayerId: "alice" },
  ]) {
    const result = applyOrdered(initial, frame(initial, "system.game_resumed", { preservePendingSeats: true, roster: [entry] }));
    expect(result.rejection).toBeDefined();
    expect(gameplay(result.state)).toBe(gameplay(initial));
  }
});
