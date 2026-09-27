import { expect, test } from "bun:test";
import { createCreatorScriptRuntime, type CreatorScriptInvocation } from "./creator-runtime";

test("entity proxies expose canonical position and queue deterministic movement", async () => {
  const runtime = await createCreatorScriptRuntime({
    scripts: { rules: "function on_drop(ctx) state.x = self.position.x; self:move_to({x=4,y=2,z=-3}) end" },
    instructionBudget: 50_000,
  });
  const queued: unknown[] = [];
  const transform = {
    position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 2, y: 2, z: 2 },
  };
  const request: CreatorScriptInvocation = {
    state: { settings: {}, scriptState: {}, players: {}, seats: {}, entities: { pawn: { components: { transform } } } },
    scriptState: {}, binding: { scriptId: "rules", bindingId: "pawn", props: {}, entityId: "pawn" },
    functionName: "on_drop", context: { entityId: "pawn" }, readOnly: false,
    bridge: {
      queue(action) { queued.push(action); }, randomInt() { return 1; }, randomFloat() { return 0; }, allocateTimerId() { return "timer"; },
    },
  };
  try {
    const result = await runtime.invoke(request);
    expect(result.ok).toBeTrue();
    expect(result.scriptState).toMatchObject({ x: 1 });
    expect(queued).toEqual([{ type: "entity.move", payload: {
      entityId: "pawn", transform: { position: { x: 4, y: 2, z: -3 }, rotation: transform.rotation, scale: transform.scale },
    } }]);
  } finally { runtime.close(); }
});
