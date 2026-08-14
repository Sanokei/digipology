import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "digipology-canonical-json";
import {
  applyOrdered,
  snapshot,
  type CanonicalGameState,
  type EntityRecord,
} from "digipology-kernel";

import { DemoLuaHost, createFirstDealInitialState } from "../../../../../packages/demo-games/src/test-support";
import { FIRST_DEAL_LUA } from "../../../../../packages/demo-games/src/games/first-deal/game.lua";
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
      components: { counter: { value: 0, default: 0, min: 0, max: 20 } },
    };
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

  test("matches the First Deal DemoLuaHost emitted action loop", async () => {
    const initial = createFirstDealInitialState();
    const draft = createEmptyEditorDraft("first-deal-playtest", "2026-01-01T00:00:00.000Z");
    draft.title = "First Deal";
    draft.minPlayers = 2;
    draft.maxPlayers = 4;
    draft.bundle.title = draft.title;
    draft.bundle.gameId = "builtin_first_deal";
    draft.bundle.releaseId = initial.releaseId;
    draft.bundle.minPlayers = 2;
    draft.bundle.maxPlayers = 4;
    draft.bundle.initialSnapshot = snapshot(initial);
    updateScript(draft, "scripts/game.lua", FIRST_DEAL_LUA);
    rebuildDraftIntegrity(draft);

    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(draft), () => undefined);
    const host = await DemoLuaHost.create("builtin_first_deal_1");
    let expected = applyOrdered(initial, {
      sequence: 1,
      actionId: "expected-start",
      actor: { type: "system" },
      action: { type: "system.game_start", payload: { settings: initial.settings } },
    }).state;
    const actions = await host.callback({ beforeSequence: 1, callback: "on_start", actionSequences: [] }, expected);
    for (const [index, action] of actions.entries()) {
      expected = applyOrdered(expected, {
        sequence: expected.sequence + 1,
        actionId: `expected-script-${index}`,
        actor: { type: "script", scriptId: "scripts/game.lua" },
        action,
      }).state;
    }
    expect(runtime.getState().entities.deck?.components.container?.items).toEqual(expected.entities.deck?.components.container?.items);
    for (const handId of ["hand_seat_1", "hand_seat_2", "hand_seat_3"]) {
      expect(runtime.getState().entities[handId]?.components.container?.items).toEqual(expected.entities[handId]?.components.container?.items);
    }
    runtime.close();
    host.close();
  }, 20_000);
});
