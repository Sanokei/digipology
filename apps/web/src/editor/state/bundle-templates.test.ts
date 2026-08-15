import { describe, expect, test } from "bun:test";
import { canonicalStringify, hashValue } from "digipology-canonical-json";
import type { CanonicalGameState } from "digipology-kernel";

import { prevalidateRelease } from "../../releaseValidation";
import { draftToCreatePrefill } from "../publish";
import { PlaytestRuntime, compileDraftForPlaytest } from "../playtest/runtime";
import {
  createCardGameEditorDraft,
  createDiceGameEditorDraft,
  createEditorDraftFromTemplate,
  createEmptyEditorDraft,
  createZoneGameEditorDraft,
  exportBundleText,
} from "./bundle";
import { EditorStore } from "./EditorStore";
import { deserializeEditorDraft, serializeEditorDraft } from "./persistence";
import type { EditorDraft } from "./types";

const NOW = "2026-08-15T12:00:00.000Z";
const DROP_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function expectValid(draft: EditorDraft): void {
  const result = prevalidateRelease(
    canonicalStringify(draft.bundle),
    draft.minPlayers,
    draft.maxPlayers,
  );
  expect(result.report.filter((item) => !item.ok)).toEqual([]);
  expect(result.bundle).not.toBeNull();
}

describe("executable editor templates", () => {
  test("Blank Table preserves the existing empty draft byte-for-byte", () => {
    expect(canonicalStringify(createEditorDraftFromTemplate("blank", "blank", NOW)))
      .toBe(canonicalStringify(createEmptyEditorDraft("blank", NOW)));
  });

  test("Card Game validates, boots, deals, and draws another card", async () => {
    const draft = createCardGameEditorDraft("cards", NOW);
    expectValid(draft);
    const logs: Array<{ level: string }> = [];
    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(draft), (entry) => logs.push(entry));
    try {
      const hand = () => runtime.getState().entities.player_hand?.components.container?.items ?? [];
      expect(hand()).toHaveLength(1);
      await runtime.dispatchInteraction("button.press", { entityId: "draw_button" });
      expect(hand()).toHaveLength(2);
      expect(logs.some((entry) => entry.level === "error")).toBe(false);
    } finally {
      runtime.close();
    }
  }, 20_000);

  test("Dice Game validates, boots, and a roll changes its score counter", async () => {
    const draft = createDiceGameEditorDraft("dice", NOW);
    expectValid(draft);
    const logs: Array<{ level: string }> = [];
    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(draft), (entry) => logs.push(entry));
    try {
      expect(runtime.getState().entities.score?.components.counter?.value).toBe(0);
      await runtime.dispatchInteraction("die.roll", { entityId: "die" });
      expect(runtime.getState().entities.score?.components.counter?.value).toBeGreaterThan(0);
      expect(logs.some((entry) => entry.level === "error")).toBe(false);
    } finally {
      runtime.close();
    }
  }, 20_000);

  test("Zone Game validates, boots, snaps a drop, and scores its zone entry", async () => {
    const draft = createZoneGameEditorDraft("zone", NOW);
    expectValid(draft);
    const logs: Array<{ level: string }> = [];
    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(draft), (entry) => logs.push(entry));
    try {
      await runtime.dispatchInteraction("entity.grab", { entityId: "runner" });
      await runtime.dispatchInteraction("entity.drop", { entityId: "runner", transform: DROP_TRANSFORM });
      expect(runtime.getState().entities.board_slot?.components["snap-point"]?.attached).toEqual(["runner"]);
      expect(runtime.getState().entities.score?.components.counter?.value).toBe(1);
      expect(logs.some((entry) => entry.level === "error")).toBe(false);
    } finally {
      runtime.close();
    }
  }, 20_000);

  test("template seeds have pinned canonical hashes", () => {
    const hashes = {
      card: hashValue(createCardGameEditorDraft("stable", NOW)),
      dice: hashValue(createDiceGameEditorDraft("stable", NOW)),
      zone: hashValue(createZoneGameEditorDraft("stable", NOW)),
    };
    expect(hashes).toEqual({
      card: "sha256:30b5525a536b9ce8f30c25fc858af3b9582215ff5897d95539968d8c5d43046e",
      dice: "sha256:5a889a181d9cafb58e7ac15e42dd63206626eec0cfbe31b498794f691fde0d31",
      zone: "sha256:241857876219e370f2f22539e2965a029548a625fec0b596ec517fd0817e1f09",
    });
  });

  test("semantic capacity edits keep the Card Game deal flow playable without Lua changes", async () => {
    const draft = createCardGameEditorDraft("capacity", NOW);
    const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
    state.entities.player_hand!.components.container!.capacity = 4;
    const runtime = await PlaytestRuntime.create(compileDraftForPlaytest(draft), () => undefined);
    try {
      expect(runtime.getState().entities.player_hand?.components.container?.items).toHaveLength(1);
    } finally {
      runtime.close();
    }
  }, 20_000);

  test("template seeds use the ordinary autosave, history, export, and publish paths", () => {
    const factories = [
      createCardGameEditorDraft,
      createDiceGameEditorDraft,
      createZoneGameEditorDraft,
    ] as const;

    for (const [index, factory] of factories.entries()) {
      let scheduledSave: (() => void) | null = null;
      const saved: EditorDraft[] = [];
      const draft = factory(`ordinary-${index}`, NOW);
      const store = new EditorStore(draft, {
        defer: (callback) => callback(),
        setTimer: (callback) => {
          scheduledSave = callback;
          return { index } as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
        saveDraft: (value) => saved.push(value),
        now: () => NOW,
      });

      store.applySceneCommand("Rename template", (value) => { value.title = "Edited template"; });
      expect(store.getSnapshot().draft.title).toBe("Edited template");
      store.undo();
      expect(store.getSnapshot().draft.title).toBe(draft.title);
      store.redo();
      expect(store.getSnapshot().draft.title).toBe("Edited template");
      expect(scheduledSave).not.toBeNull();
      (scheduledSave as unknown as () => void)();
      expect(saved).toHaveLength(1);

      const persisted = deserializeEditorDraft(serializeEditorDraft(saved[0]!));
      expect(persisted?.id).toBe(draft.id);
      expect(JSON.parse(exportBundleText(saved[0]!))).toEqual(saved[0]!.bundle);
      expect(draftToCreatePrefill(saved[0]!).editorDraftPrefill.bundleText)
        .toBe(canonicalStringify(saved[0]!.bundle));
    }
  });
});
