import { describe, expect, test } from "bun:test";
import { hashValue } from "digipology-canonical-json";
import { createRng } from "digipology-prng";
import {
  applyOrdered,
  applyOrderedWithScripts,
  cloneCanonical,
  createInitialState,
  defaultActionRegistry,
  type CanonicalGameState,
  type OrderedActionInput,
  type ScriptRuntime,
} from "./index";

function stateWithBindings(ids: string[] = ["b"]): CanonicalGameState {
  return createInitialState({
    releaseId: "script-test",
    rng: createRng("script-test").state(),
    players: { player: { id: "player" }, other: { id: "other" } },
    entities: {
      score: { id: "score", components: { counter: { value: 0, default: 0, min: null, max: null } } },
      button: {
        id: "button",
        components: {
          button: { enabled: true, label: "Go" },
          ...ids.reduce<Record<string, never>>((value) => value, {}),
        },
      },
      ...Object.fromEntries(ids.map((bindingId) => [bindingId, {
        id: bindingId,
        components: { script: { scriptId: `${bindingId}.lua`, bindingId, props: {} } },
      }])),
    },
  });
}

function ordered(state: CanonicalGameState, type: string, payload: unknown, actor: OrderedActionInput["actor"] = { type: "system" }): OrderedActionInput {
  return { sequence: state.sequence + 1, actionId: `action-${state.sequence + 1}`, actor, action: { type, payload: payload as never } };
}

function gameplayHash(state: CanonicalGameState): string {
  const copy = cloneCanonical(state);
  copy.sequence = 0;
  return hashValue(copy);
}

describe("kernel-owned script transactions", () => {
  test("dispatches three subscribers in stable ScriptBindingId order", async () => {
    const calls: string[] = [];
    const runtime: ScriptRuntime = {
      bindings(state) {
        return Object.values(state.entities).flatMap((entity) => {
          const script = entity.components.script;
          return script === undefined ? [] : [{ ...script, entityId: entity.id }];
        }).reverse();
      },
      async invoke(request) {
        calls.push(request.binding.bindingId);
        const prior = typeof request.scriptState === "object" && request.scriptState !== null && !Array.isArray(request.scriptState)
          ? request.scriptState : {};
        return { ok: true, handled: true, scriptState: { ...prior, calls: [...calls] } };
      },
    };
    const initial = stateWithBindings(["binding-c", "binding-a", "binding-b"]);
    const result = await applyOrderedWithScripts(initial, ordered(initial, "system.game_start", { settings: {} }), { runtime });
    expect(result.rejection).toBeUndefined();
    expect(calls).toEqual(["binding-a", "binding-b", "binding-c"]);
    expect(result.state.scriptState).toEqual({ calls: ["binding-a", "binding-b", "binding-c"] });
  });

  test("callback failure discards prior commands and reports complete diagnostics", async () => {
    const runtime: ScriptRuntime = {
      bindings: () => [
        { scriptId: "a.lua", bindingId: "a", props: {} },
        { scriptId: "b.lua", bindingId: "b", props: {} },
      ],
      async invoke(request) {
        if (request.binding.bindingId === "a") {
          request.bridge.queue({ type: "counter.add", payload: { entityId: "score", amount: 4 } });
          return { ok: true, handled: true, scriptState: { touched: true } };
        }
        return { ok: false, error: { kind: "runtime", line: 7, message: "boom" } };
      },
    };
    const initial = stateWithBindings();
    const before = gameplayHash(initial);
    const result = await applyOrderedWithScripts(initial, ordered(initial, "system.game_start", { settings: {} }), { runtime });
    expect(result.state.sequence).toBe(1);
    expect(gameplayHash(result.state)).toBe(before);
    expect(result.events.map(({ type }) => type)).toEqual(["action.rejected", "script.error"]);
    expect(result.events[1]?.data).toMatchObject({
      script: "b.lua", binding: "b", function: "on_start", line: 7, message: "boom", sequence: 1,
    });
  });

  test("subcommand validation failure rolls back earlier FIFO work", async () => {
    const runtime: ScriptRuntime = {
      bindings: () => [{ scriptId: "rules.lua", bindingId: "rules", props: {} }],
      async invoke(request) {
        request.bridge.queue({ type: "counter.add", payload: { entityId: "score", amount: 2 } });
        request.bridge.queue({ type: "counter.add", payload: { entityId: "missing", amount: 1 } });
        return { ok: true, handled: true, scriptState: { changed: true } };
      },
    };
    const initial = stateWithBindings();
    const result = await applyOrderedWithScripts(initial, ordered(initial, "system.game_start", { settings: {} }), { runtime });
    expect(result.rejection?.reason).toContain("missing");
    expect(gameplayHash(result.state)).toBe(gameplayHash(initial));
    expect(result.events[1]?.data.kind).toBe("validation");
  });

  test("guards cannot queue mutations and a deny reason reaches rejection", async () => {
    const mutationRuntime: ScriptRuntime = {
      bindings: () => [{ scriptId: "guard.lua", bindingId: "guard", entityId: "button", props: {} }],
      async invoke(request) {
        request.bridge.queue({ type: "counter.add", payload: { entityId: "score", amount: 1 } });
        return { ok: true, handled: true, allowed: true };
      },
    };
    const initial = stateWithBindings();
    initial.entities.button!.components.script = { scriptId: "guard.lua", bindingId: "guard", props: {} };
    const attempted = await applyOrderedWithScripts(
      initial,
      ordered(initial, "button.press", { entityId: "button" }, { type: "player", playerId: "player" }),
      { runtime: mutationRuntime },
    );
    expect(attempted.rejection?.reason).toContain("guards cannot queue");
    expect((attempted.state.entities.score?.components.counter as { value: number }).value).toBe(0);

    const denyRuntime: ScriptRuntime = {
      bindings: mutationRuntime.bindings,
      invoke: async () => ({ ok: true, handled: true, allowed: false, reason: "Wait your turn" }),
    };
    const denied = await applyOrderedWithScripts(
      initial,
      ordered(initial, "button.press", { entityId: "button" }, { type: "player", playerId: "player" }),
      { runtime: denyRuntime },
    );
    expect(denied.rejection?.reason).toBe("Wait your turn");
  });
});

describe("canonical prompt and timer actions", () => {
  test("registers creator lifecycle actions in the default registry", () => {
    for (const type of ["prompt.create", "prompt.respond", "prompt.cancel", "timer.register", "timer.cancel", "system.timer_fire"]) {
      expect(defaultActionRegistry.get(type)).toBeDefined();
      expect(defaultActionRegistry.types()).toContain(type);
    }
  });

  test("validates prompt target/schema and prevents a second response", () => {
    let state = stateWithBindings();
    state = applyOrdered(state, ordered(state, "prompt.create", {
      id: "bid", kind: "number", playerId: "player", title: "Bid", min: 0, max: 10, step: 2, default: 4,
    }, { type: "script", scriptId: "rules" })).state;
    expect(state.prompts.bid?.status).toBe("open");
    const wrong = applyOrdered(state, ordered(state, "prompt.respond", { promptId: "bid", response: 4 }, { type: "player", playerId: "other" }));
    expect(wrong.rejection?.reason).toContain("prompted player");
    const range = applyOrdered(wrong.state, ordered(wrong.state, "prompt.respond", { promptId: "bid", response: 3 }, { type: "player", playerId: "player" }));
    expect(range.rejection?.reason).toContain("range or step");
    const valid = applyOrdered(range.state, ordered(range.state, "prompt.respond", { promptId: "bid", response: 6 }, { type: "player", playerId: "player" }));
    expect(valid.state.prompts.bid).toMatchObject({ status: "resolved", response: 6 });
    const twice = applyOrdered(valid.state, ordered(valid.state, "prompt.respond", { promptId: "bid", response: 8 }, { type: "player", playerId: "player" }));
    expect(twice.rejection?.reason).toContain("already resolved");
  });

  test("timer fire is exactly once and cancellation prevents firing", () => {
    let state = stateWithBindings();
    state = applyOrdered(state, ordered(state, "timer.register", {
      timerId: "t1", delay: 5, callback: "finish", scriptId: "rules", bindingId: "b",
    }, { type: "script", scriptId: "rules" })).state;
    const fired = applyOrdered(state, ordered(state, "system.timer_fire", { timerId: "t1" }));
    expect(fired.state.timers?.t1?.status).toBe("fired");
    const duplicate = applyOrdered(fired.state, ordered(fired.state, "system.timer_fire", { timerId: "t1" }));
    expect(duplicate.rejection?.reason).toContain("already fired");

    state = applyOrdered(duplicate.state, ordered(duplicate.state, "timer.register", {
      timerId: "t2", delay: 5, callback: "finish", scriptId: "rules", bindingId: "b",
    }, { type: "script", scriptId: "rules" })).state;
    state = applyOrdered(state, ordered(state, "timer.cancel", { timerId: "t2" }, { type: "script", scriptId: "rules" })).state;
    const canceled = applyOrdered(state, ordered(state, "system.timer_fire", { timerId: "t2" }));
    expect(canceled.rejection?.reason).toContain("canceled");
  });
});
