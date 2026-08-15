import { describe, expect, test } from "bun:test";
import {
  applyOrderedWithScripts,
  cloneCanonical,
  createInitialState,
  defaultActionRegistry,
  snapshot,
  type CanonicalGameState,
  type OrderedActionInput,
} from "digipology-kernel";
import {
  PROXY_ACTIONS,
  createCreatorScriptRuntime,
} from "digipology-lua";

const RNG = { algorithm: "sfc32-v1" as const, state: [1, 2, 3, 4] as [number, number, number, number], draws: 0 };

function action(state: CanonicalGameState, type: string, payload: unknown, actor: OrderedActionInput["actor"]): OrderedActionInput {
  return { sequence: state.sequence + 1, actionId: `a-${state.sequence + 1}`, actor, action: { type, payload: payload as never } };
}

describe("creator API adapter", () => {
  test("every mutating proxy member maps to a registered script action", () => {
    const types = new Set(defaultActionRegistry.types());
    for (const mapped of Object.values(PROXY_ACTIONS)) {
      expect(types.has(mapped)).toBe(true);
      expect(defaultActionRegistry.get(mapped)?.sources).toContain("script");
    }
    expect(Object.keys(PROXY_ACTIONS)).not.toContain("Die.set_value");
    expect(Object.keys(PROXY_ACTIONS)).not.toContain("SnapPoint.detach");
    expect(Object.keys(PROXY_ACTIONS)).not.toContain("Button.set_enabled");
  });

  test("orders container, zone, and player proxy collections deterministically", async () => {
    const runtime = await createCreatorScriptRuntime({
      scripts: { rules: `
function on_start()
  state.container_ids = {}
  for i, item in ipairs(refs.box:list()) do state.container_ids[i] = item.id end
  state.zone_ids = {}
  for i, item in ipairs(refs.zone.entities) do state.zone_ids[i] = item.id end
  state.player_ids = {}
  for i, player in ipairs(players:list()) do state.player_ids[i] = player.id end
end` },
      refs: { box: "box", zone: "zone" },
      instructionBudget: 50_000,
    });
    const initial = createInitialState({
      releaseId: "ordering",
      rng: RNG,
      players: { p0: { id: "p0" }, p2: { id: "p2" }, p1: { id: "p1" } },
      seats: { seat_b: { id: "seat_b", playerId: "p2" }, seat_a: { id: "seat_a", playerId: "p1" } },
      entities: {
        z: { id: "z", components: {} }, a: { id: "a", components: {} }, m: { id: "m", components: {} },
        box: { id: "box", components: { container: { items: ["z", "a", "m"], capacity: null, ordering: "ordered", visibility: "public" } } },
        zone: {
          id: "zone",
          components: {
            transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
            zone: { shape: "box", acceptedTags: [], visibleInPlay: true, members: ["a", "m", "z"] },
            script: { scriptId: "rules", bindingId: "rules", props: {} },
          },
        },
      },
    });
    const result = await applyOrderedWithScripts(initial, action(initial, "system.game_start", { settings: {} }, { type: "system" }), { runtime });
    expect(result.state.scriptState).toMatchObject({
      container_ids: ["a", "m", "z"], zone_ids: ["a", "m", "z"], player_ids: ["p1", "p2", "p0"],
    });
    runtime.close();
  });

  test("budget, memory, and RNG-consuming failures all roll back atomically", async () => {
    const base = createInitialState({
      releaseId: "atomic",
      rng: RNG,
      entities: { rules: { id: "rules", components: { script: { scriptId: "rules", bindingId: "rules", props: {} } } } },
    });
    const budget = await createCreatorScriptRuntime({
      scripts: { rules: "function on_start() while true do end end" }, instructionBudget: 1_000,
    });
    const exhausted = await applyOrderedWithScripts(base, action(base, "system.game_start", { settings: {} }, { type: "system" }), { runtime: budget });
    expect(exhausted.events[1]?.data.kind).toBe("budget_exceeded");
    expect(exhausted.state.rng).toEqual(base.rng);
    budget.close();

    const memory = await createCreatorScriptRuntime({
      scripts: { rules: 'function on_start() local values={} while true do values[#values+1]=string.rep("x",1024) end end' },
      instructionBudget: 10_000_000,
      memoryBudgetBytes: 32_768,
    });
    const outOfMemory = await applyOrderedWithScripts(base, action(base, "system.game_start", { settings: {} }, { type: "system" }), { runtime: memory });
    expect(outOfMemory.events[1]?.data.kind).toBe("memory_exceeded");
    expect(outOfMemory.state.rng).toEqual(base.rng);
    memory.close();

    const failing = await createCreatorScriptRuntime({
      scripts: { rules: "function on_start() state.roll=random:int(1, 6); error('after draw') end" }, instructionBudget: 50_000,
    });
    const failed = await applyOrderedWithScripts(base, action(base, "system.game_start", { settings: {} }, { type: "system" }), { runtime: failing });
    const comparable = cloneCanonical(failed.state); comparable.sequence = 0;
    expect(snapshot({ ...comparable, sequence: 0 }).stateHash).toBe(snapshot(base).stateHash);
    expect(failed.state.rng).toEqual(base.rng);
    failing.close();
  });

  test("enforces read-only guard state and proxy capabilities", async () => {
    const makeState = () => createInitialState({
      releaseId: "guard",
      rng: RNG,
      players: { player: { id: "player" } },
      entities: {
        card: {
          id: "card",
          components: {
            transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
            flippable: { flipped: false },
            script: { scriptId: "rules", bindingId: "rules", props: {} },
          },
        },
        score: { id: "score", components: { counter: { value: 0, default: 0, min: null, max: null } } },
      },
    });
    for (const source of [
      "function can_flip() state.changed=true return true end",
      "function can_flip() refs.score:add(1) return true end",
    ]) {
      const runtime = await createCreatorScriptRuntime({ scripts: { rules: source }, refs: { score: "score" }, instructionBudget: 50_000 });
      const initial = makeState();
      const result = await applyOrderedWithScripts(
        initial,
        action(initial, "entity.flip", { entityId: "card" }, { type: "player", playerId: "player" }),
        { runtime },
      );
      expect(result.events.map(({ type }) => type)).toEqual(["action.rejected", "script.error"]);
      expect(result.state.entities.card?.components.flippable?.flipped).toBe(false);
      expect(result.state.entities.score?.components.counter?.value).toBe(0);
      runtime.close();
    }
  });

  test("Card.is_face_up follows canonical flippable state, not the authored card default", async () => {
    const runtime = await createCreatorScriptRuntime({
      scripts: { rules: `
function on_start()
  state.was_face_up = refs.card.is_face_up
  refs.card:set_face_up(true)
end` },
      refs: { card: "card" },
      instructionBudget: 50_000,
    });
    const initial = createInitialState({
      releaseId: "face-up",
      rng: RNG,
      entities: {
        card: {
          id: "card",
          components: {
            transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
            card: { definitionId: "ace", faceUp: true },
            flippable: { flipped: false },
            script: { scriptId: "rules", bindingId: "rules", props: {} },
          },
        },
      },
    });
    const result = await applyOrderedWithScripts(initial, action(initial, "system.game_start", { settings: {} }, { type: "system" }), { runtime });
    expect(result.rejection).toBeUndefined();
    expect((result.state.scriptState as { was_face_up?: boolean }).was_face_up).toBe(false);
    expect(result.state.entities.card?.components.flippable?.flipped).toBe(true);
    runtime.close();
  });

  test("prompt, timer reconstruction, turns, and scores double-replay identically", async () => {
    const source = `
function on_start()
  turns:start()
  scores:set(turns:current(), 2)
  ui:confirm(turns:current(), { id = "ready", title = "Ready?" })
end
function on_prompt(ctx)
  if ctx.response then state.timer_id = timer:after(2, "advance") end
end
function advance()
  local next_player = turns:next()
  scores:add(next_player, 3)
  state.leader = scores:leader().id
end`;
    const replay = async () => {
      let state = createInitialState({
        releaseId: "stdlib",
        rng: RNG,
        players: { b: { id: "b" }, a: { id: "a" } },
        seats: { seat_2: { id: "seat_2", playerId: "b" }, seat_1: { id: "seat_1", playerId: "a" } },
        entities: { rules: { id: "rules", components: { script: { scriptId: "rules", bindingId: "rules", props: {} } } } },
      });
      let runtime = await createCreatorScriptRuntime({ scripts: { rules: source }, instructionBudget: 50_000 });
      state = (await applyOrderedWithScripts(state, action(state, "system.game_start", { settings: {} }, { type: "system" }), { runtime })).state;
      runtime.close();
      runtime = await createCreatorScriptRuntime({ scripts: { rules: source }, instructionBudget: 50_000 });
      state = (await applyOrderedWithScripts(state, action(state, "prompt.respond", { promptId: "ready", response: true }, { type: "player", playerId: "a" }), { runtime })).state;
      runtime.close();
      runtime = await createCreatorScriptRuntime({ scripts: { rules: source }, instructionBudget: 50_000 });
      state = (await applyOrderedWithScripts(state, action(state, "system.timer_fire", { timerId: "timer_a-2_0" }, { type: "system" }), { runtime })).state;
      runtime.close();
      return snapshot(state);
    };
    const first = await replay();
    const second = await replay();
    expect(first.stateHash).toBe(second.stateHash);
    // Pinned stdlib v1 determinism hash: prompt + timer + turns/scores over a fresh VM per action.
    // Changing this value means the Lua stdlib or the canonical state it produces changed shape.
    expect(first.stateHash).toBe("sha256:7531016d794e95936ccc80cefea2032d9cbdbe6005bb80d247082048935ccc44");
    expect((first.state.scriptState as { leader?: string }).leader).toBe("b");
  }, 20_000);
});
