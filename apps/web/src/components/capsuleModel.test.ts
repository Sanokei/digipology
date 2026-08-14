import { describe, expect, it } from "bun:test";

import { capsuleKeyboardAction, createHoverIntentModel, HOVER_INTENT_MS } from "./capsuleModel";

interface FakeTask { at: number; cancelled: boolean; callback(): void }

function fakeClock() {
  let now = 0;
  const tasks: FakeTask[] = [];
  return {
    schedule(callback: () => void, delay: number) {
      const task = { at: now + delay, cancelled: false, callback };
      tasks.push(task);
      return task;
    },
    cancel(handle: unknown) { (handle as FakeTask).cancelled = true; },
    advance(ms: number) {
      now += ms;
      for (const task of tasks) if (!task.cancelled && task.at <= now) { task.cancelled = true; task.callback(); }
    },
  };
}

describe("hover intent", () => {
  it("fires at exactly 350 ms", () => {
    const clock = fakeClock();
    let reveals = 0;
    const model = createHoverIntentModel(clock.schedule, clock.cancel, () => { reveals += 1; });
    model.enter();
    clock.advance(HOVER_INTENT_MS - 1);
    expect(reveals).toBe(0);
    clock.advance(1);
    expect(reveals).toBe(1);
  });

  it("cancels on leave and never fires afterward", () => {
    const clock = fakeClock();
    let reveals = 0;
    const model = createHoverIntentModel(clock.schedule, clock.cancel, () => { reveals += 1; });
    model.enter();
    clock.advance(200);
    model.leave();
    clock.advance(500);
    expect(reveals).toBe(0);
  });

  it("re-enter restarts the full delay", () => {
    const clock = fakeClock();
    let reveals = 0;
    const model = createHoverIntentModel(clock.schedule, clock.cancel, () => { reveals += 1; });
    model.enter();
    clock.advance(300);
    model.leave();
    model.enter();
    clock.advance(349);
    expect(reveals).toBe(0);
    clock.advance(1);
    expect(reveals).toBe(1);
  });
});

describe("capsule keyboard action", () => {
  it("maps Enter to quick play without hijacking other keys", () => {
    expect(capsuleKeyboardAction("Enter")).toBe("quickplay");
    expect(capsuleKeyboardAction(" ")).toBeNull();
    expect(capsuleKeyboardAction("Escape")).toBeNull();
  });
});
