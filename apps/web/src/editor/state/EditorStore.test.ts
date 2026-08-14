import { describe, expect, test } from "bun:test";

import { AUTO_SAVE_DEBOUNCE_MS, MAX_HISTORY_ENTRIES } from "./constants";
import { EditorStore } from "./EditorStore";
import { editorTestDraft } from "./testFixtures";

describe("EditorStore", () => {
  test("applies commands, undoes, redoes, and keeps snapshots stable between changes", () => {
    const store = new EditorStore(editorTestDraft());
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    store.applySceneCommand("Rename", (draft) => { draft.title = "Changed"; });
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().draft.title).toBe("Changed");
    store.undo();
    expect(store.getSnapshot().draft.title).toBe("Untitled Game");
    store.redo();
    expect(store.getSnapshot().draft.title).toBe("Changed");
  });

  test("caps deep-clone history and clears redo after a new command", () => {
    const store = new EditorStore(editorTestDraft());
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 7; index += 1) {
      store.applySceneCommand(`Change ${index}`, (draft) => { draft.tagline = String(index); });
    }
    expect(store.getSnapshot().past).toHaveLength(MAX_HISTORY_ENTRIES);
    store.undo();
    expect(store.getSnapshot().future).toHaveLength(1);
    store.applySceneCommand("Branch", (draft) => { draft.tagline = "branch"; });
    expect(store.getSnapshot().future).toHaveLength(0);
  });

  test("coalesces begin, preview mutations, and commit into one history frame", () => {
    const store = new EditorStore(editorTestDraft());
    store.beginCoalescedSceneCommand("Scrub title");
    store.mutateDuringCoalescedSceneCommand((draft) => { draft.tagline = "a"; });
    store.mutateDuringCoalescedSceneCommand((draft) => { draft.tagline = "ab"; });
    store.commitCoalescedSceneCommand();
    expect(store.getSnapshot().past).toHaveLength(1);
    expect(store.getSnapshot().draft.tagline).toBe("ab");
    store.undo();
    expect(store.getSnapshot().draft.tagline).toBe("");
  });

  test("autosaves once 2.5 seconds after the last change", () => {
    const scheduled: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
    const saved: string[] = [];
    const store = new EditorStore(editorTestDraft(), {
      defer: (callback) => callback(),
      setTimer: (callback, delay) => {
        const timer = { callback, delay, cancelled: false };
        scheduled.push(timer);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (handle) => { (handle as unknown as { cancelled: boolean }).cancelled = true; },
      saveDraft: (draft) => saved.push(draft.tagline),
    });
    store.applySceneCommand("First", (draft) => { draft.tagline = "first"; });
    store.applySceneCommand("Second", (draft) => { draft.tagline = "second"; });
    expect(scheduled.map((timer) => timer.delay)).toEqual([AUTO_SAVE_DEBOUNCE_MS, AUTO_SAVE_DEBOUNCE_MS]);
    expect(scheduled[0]!.cancelled).toBe(true);
    scheduled[1]!.callback();
    expect(saved).toEqual(["second"]);
    expect(store.getSnapshot().saveStatus).toBe("saved");
  });
});
