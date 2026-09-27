import { expect, test } from "bun:test";
import { applyOrderedWithScripts, createInitialState, loadSnapshot, snapshot, type CanonicalGameState, type OrderedActionInput } from "digipology-kernel";
import { createCreatorScriptRuntime } from "../../../packages/lua/src/creator-runtime";
import { resumedRosterFromSave } from "./room-core";

const rules = `
function on_player_join(ctx) scores:set(ctx.player, 0) end
function on_seat_claimed(ctx)
  state.claims = (state.claims or 0) + 1
  state.claim_score = scores:get(ctx.playerId)
end
function cycle(ctx)
  state.current = turns:current().id
  state.next_player = turns:next().id
end
`;

async function replay(repeat: boolean, active = true, prejoined = false, extraPlayer = false) {
  const runtime = await createCreatorScriptRuntime({ scripts: { rules }, instructionBudget: 50_000 });
  let state = createInitialState({ releaseId: "pending-golden", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    players: { alice: { id: "alice" }, bob: { id: "bob" }, charlie: { id: "charlie" } },
    seats: { seat_2: { id: "seat_2", playerId: "charlie" }, seat_10: { id: "seat_10", playerId: "bob" }, seat_1: { id: "seat_1", playerId: "alice" } },
    entities: Object.fromEntries(["a", "b"].map((id) => [id, { id, components: { script: { scriptId: "rules", bindingId: id, props: {} } } }])),
    prompts: { choice: { id: "choice", kind: "confirm", playerId: "charlie", title: "Continue?", status: "open" } },
    scriptState: { __stdlib: { turns: { active, order: ["bob", "charlie", "alice"], index: 2 }, scores: { alice: 4, bob: 7, charlie: 9, team: 20 } } },
  });
  const hashes = [snapshot(state).stateHash];
  const apply = async (type: string, payload: unknown) => {
    const ordered: OrderedActionInput<unknown> = { sequence: state.sequence + 1, actionId: `replay_${state.sequence + 1}`, actor: { type: "system" }, action: { type, payload } };
    const result = await applyOrderedWithScripts(state, ordered, { runtime });
    expect(result.rejection).toBeUndefined();
    state = loadSnapshot(snapshot(result.state));
    hashes.push(snapshot(state).stateHash);
    const stdlib = state.scriptState as { __stdlib: { turns: { order: string[]; index: number; active: boolean }; scores: Record<string, number> } };
    expect(stdlib.__stdlib.turns.order.every((id) => state.players[id] !== undefined)).toBe(true);
    expect(Object.keys(stdlib.__stdlib.scores).filter((id) => id !== "team").every((id) => state.players[id] !== undefined)).toBe(true);
  };
  try {
    await apply("system.game_resumed", { preservePendingSeats: true, roster: resumedRosterFromSave(state, [{ playerId: "host", displayName: "Host" }]) });
    expect(state.pendingSeats?.seat_10?.player.id).toBe("bob");
    expect(state.pendingSeats?.seat_2?.player.id).toBe("charlie");
    await apply("system.seat_claim", { playerId: "guest", seatId: "seat_10", previousPlayerId: "bob" });
    expect(state.scriptState).toMatchObject({ __stdlib: { scores: { guest: 7 }, turns: { active: false } } });
    expect((state.scriptState as Record<string, unknown>).claim_score).toBeUndefined();
    if (repeat) {
      state = loadSnapshot(snapshot({ ...state, sequence: 0 }));
      hashes.push(snapshot(state).stateHash);
      const roster = [ { playerId: "host2", displayName: "Host2" }, { playerId: "guest2", displayName: "Guest2" },
        ...(prejoined ? [{ playerId: "last", displayName: "Last" }] : []) ];
      await apply("system.game_resumed", { preservePendingSeats: true, roster: resumedRosterFromSave(state, roster) });
    }
    if (extraPlayer) {
      await apply("system.player_joined", { playerId: "extra", name: "Extra" });
      await apply("system.seat_assign", { playerId: "extra", seatId: "seat_3" });
    }
    if (!prejoined) await apply("system.seat_claim", { playerId: "last", seatId: "seat_2", previousPlayerId: "charlie" });
    expect(state.pendingSeats).toBeUndefined();
    expect(state.prompts.choice?.playerId).toBe("last");
    const host = repeat ? "host2" : "host", guest = repeat ? "guest2" : "guest";
    expect(state.scriptState).toMatchObject({ __stdlib: {
      scores: { [host]: 4, [guest]: 7, last: 9, team: 20 },
      turns: { order: [guest, "last", host, ...(extraPlayer ? ["extra"] : [])], index: 2, active },
    } });
    expect((state.scriptState as { __stdlib: Record<string, unknown> }).__stdlib.pending_resume).toBeUndefined();
    return { hashes, state };
  } finally { runtime.close(); }
}

test.each([false, true])("scripted multi-binding seat recovery, repeat save=%s, replays identically", async (repeat) => {
  const a = await replay(repeat);
  const b = await replay(repeat);
  expect(a.hashes).toEqual(b.hashes);
  expect(snapshot(a.state)).toEqual(snapshot(b.state));
});

test("repeat resume can map every remaining escrowed identity in its first action", async () => {
  await replay(true, true, true);
});

test("stopped turns remain stopped across partial claims and repeat saves", async () => {
  await replay(true, false);
});

test("pending resume additive golden hashes", async () => {
  expect((await replay(true)).hashes).toEqual([
    "sha256:f44b12cb4751a28f6f79a56521e0158d6aaa806dfee68e19236d0ca0db0fb1f4",
    "sha256:8751c3cf3c7065cf613f2c84ad82cc822b7cb221770125b6c7f63ce5dc55c144",
    "sha256:766c0aac06d72f204ae59d7944a705b7cb79d06253fa05b942bec27ec7b84734",
    "sha256:d13349b7ba3e7672eb461335ddf9b3ea890215852d2ec1bbf0384ec6f00f8037",
    "sha256:a5957f017121ed47153342b164a4d433e775cbfd0f9524500b13e2d8b70c2ad7",
    "sha256:bd6257002522761680aa1fd3df61d666f4fa80869047b1d9109dec4e48cc25d5",
  ]);
});


test("fresh players seated during the pause join after the preserved saved turn order", async () => {
  const result = await replay(false, true, false, true);
  expect(result.state.scriptState).toMatchObject({ __stdlib: { scores: { extra: 0 } } });
});
