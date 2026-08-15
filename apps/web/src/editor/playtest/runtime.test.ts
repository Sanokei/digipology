import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "digipology-canonical-json";
import {
  type CanonicalGameState,
} from "digipology-kernel";
import { EditorStore } from "../state/EditorStore";
import { createEmptyEditorDraft, rebuildDraftIntegrity } from "../state/bundle";
import { updateScript } from "../state/scripts";
import { editorTestDraft } from "../state/testFixtures";
import { compileDraftForPlaytest, PlaytestRuntime } from "./runtime";

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

describe("in-tab playtest runtime", () => {
  test("Stop discards all runtime mutations without touching draft or history", async () => {
    const draft = editorTestDraft();
    const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
    state.entities.die = {
      id: "die",
      components: {
        die: { definitionId: "standard_d6", value: 1 },
        grabbable: { enabled: true, heldBy: null },
        transform: IDENTITY,
      },
    };
    state.entities.score = {
      id: "score",
      components: {
        counter: { value: 0, default: 0, min: 0, max: 20 },
        script: { scriptId: "scripts/game.lua", bindingId: "game", props: {} },
      },
    };
    draft.bundle.refs = { card_a: "card_a", score: "score" };
    updateScript(draft, "scripts/game.lua", `
function on_start(ctx)
  refs.card_a:flip()
  refs.score:add(2)
end
`);
    rebuildDraftIntegrity(draft);
    const store = new EditorStore(draft);
    const hashBefore = canonicalStringify(store.getSnapshot().draft);
    const historyBefore = store.getSnapshot().past.length;
    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(store.getSnapshot().draft), () => undefined);
    await runtime.dispatchInteraction("entity.grab", { entityId: "card_a" });
    await runtime.dispatchInteraction("entity.drop", { entityId: "card_a", transform: IDENTITY });
    await runtime.dispatchInteraction("die.roll", { entityId: "die" });
    expect(runtime.getState().entities.score?.components.counter?.value).toBe(2);
    expect(runtime.getState().sequence).toBeGreaterThan(3);
    runtime.close();
    expect(canonicalStringify(store.getSnapshot().draft)).toBe(hashBefore);
    expect(store.getSnapshot().past).toHaveLength(historyBefore);
  }, 20_000);

  test("drives prompts and named timers through canonical actions", async () => {
    const draft = createEmptyEditorDraft("surface-playtest", "2026-01-01T00:00:00.000Z");
    const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
    state.entities.rules = {
      id: "rules",
      components: { script: { scriptId: "scripts/game.lua", bindingId: "rules", props: {} } },
    };
    state.entities.score = {
      id: "score",
      components: { counter: { value: 0, default: 0, min: 0, max: 20 } },
    };
    draft.bundle.refs = { score: "score" };
    updateScript(draft, "scripts/game.lua", `
function on_player_join(ctx)
  ui:confirm(ctx.player, { id = "ready", title = "Ready?" })
end
function on_prompt(ctx)
  if ctx.response then state.timer_id = timer:after(1, "award") end
end
function award(ctx)
  refs.score:add(3)
end
`);
    rebuildDraftIntegrity(draft);

    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(draft), () => undefined);
    expect(runtime.getState().prompts.ready?.status).toBe("open");
    await runtime.dispatchInteraction("prompt.respond", { promptId: "ready", response: true });
    expect(Object.values(runtime.getState().timers ?? {})[0]?.status).toBe("scheduled");
    await runtime.tick();
    expect(runtime.getState().entities.score?.components.counter?.value).toBe(3);
    expect(Object.values(runtime.getState().timers ?? {})[0]?.status).toBe("fired");
    runtime.close();
  }, 20_000);
});
