import { describe, expect, test } from "bun:test";

import { EditorStore } from "../../state";
import { editorTestDraft } from "../../state/testFixtures";
import { completeTextDraft, createNumberInputArrowBurst, NUMBER_INPUT_ARROW_DEBOUNCE_MS } from "./PanelComponents";

describe("CommitTextInput completion", () => {
  test("completes an unchanged edit without committing and commits a changed edit once", () => {
    const commits: string[] = [];
    let completions = 0;
    completeTextDraft("card_a", "card_a", (value) => commits.push(value), () => { completions += 1; });
    completeTextDraft("card_b", "card_a", (value) => commits.push(value), () => { completions += 1; });
    expect(commits).toEqual(["card_b"]);
    expect(completions).toBe(2);
  });

  test("a no-op entity rename creates no history frame", () => {
    const store = new EditorStore(editorTestDraft());
    store.selectEntity("card_a");
    expect(store.renameSelectedEntity("card_a")).toBe(true);
    expect(store.getSnapshot().past).toHaveLength(0);
  });
});

test("an arrow-key burst produces one undoable history frame", () => {
  const scheduled: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  const store = new EditorStore(editorTestDraft());
  const burst = createNumberInputArrowBurst({
    onStart: () => store.beginCoalescedSceneCommand("Adjusted players"),
    onStep: (value) => store.mutateDuringCoalescedSceneCommand((draft) => { draft.minPlayers = value; }),
    onEnd: () => store.endCoalescedSceneCommand(),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      scheduled.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => { (handle as unknown as { cancelled: boolean }).cancelled = true; },
  });

  burst.step(2);
  burst.step(3);
  burst.step(4);
  expect(store.getSnapshot().past).toHaveLength(0);
  expect(scheduled.map(({ delay }) => delay)).toEqual([
    NUMBER_INPUT_ARROW_DEBOUNCE_MS,
    NUMBER_INPUT_ARROW_DEBOUNCE_MS,
    NUMBER_INPUT_ARROW_DEBOUNCE_MS,
  ]);
  expect(scheduled.slice(0, -1).every(({ cancelled }) => cancelled)).toBe(true);
  scheduled.at(-1)!.callback();
  expect(store.getSnapshot().past).toHaveLength(1);
  expect(store.getSnapshot().draft.minPlayers).toBe(4);
  store.undo();
  expect(store.getSnapshot().draft.minPlayers).toBe(1);
});
