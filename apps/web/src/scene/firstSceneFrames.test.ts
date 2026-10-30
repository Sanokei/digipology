import { expect, test } from "bun:test";
import { firstSceneFrames, initializeSceneFrames } from "./firstSceneFrames";

test("first-piece frame readiness is cancelled and its pending callback removed when the attempt retires", async () => {
  const callbacks = new Map<number, FrameRequestCallback>(), cancelled: number[] = [];
  let id = 0;
  const owner = new AbortController();
  const pending = firstSceneFrames(owner.signal, (callback) => { callbacks.set(++id, callback); return id; }, (frame) => { cancelled.push(frame); callbacks.delete(frame); });
  callbacks.get(1)!(0); callbacks.delete(1); owner.abort();
  await expect(pending).rejects.toThrow("cancelled"); expect(cancelled).toEqual([2]); expect(callbacks.size).toBe(0);
});

test("readiness requires both frames and stops listening once the current frame is drawn", async () => {
  const callbacks: FrameRequestCallback[] = [], owner = new AbortController();
  let done = false;
  const pending = firstSceneFrames(owner.signal, (callback) => { callbacks.push(callback); return callbacks.length; }, () => { throw new Error("A completed frame must not be cancelled"); }).then(() => { done = true; });
  callbacks[0]!(0); await Promise.resolve(); expect(done).toBe(false);
  callbacks[1]!(16); await pending; expect(done).toBe(true); owner.abort();
});

test("software GPU work must complete before readiness frames count; retirement still cancels the pending wait", async () => {
  const callbacks: FrameRequestCallback[] = [], owner = new AbortController();
  let gpuComplete = false, done = false;
  const pending = firstSceneFrames(owner.signal, (callback) => { callbacks.push(callback); return callbacks.length; }, () => {}, () => gpuComplete).then(() => { done = true; });
  callbacks[0]!(0); callbacks[1]!(16); await Promise.resolve(); expect(done).toBe(false);
  gpuComplete = true; callbacks[2]!(32); await Promise.resolve(); expect(done).toBe(false);
  callbacks[3]!(48); await pending; expect(done).toBe(true); owner.abort();
});

test("initialization starts rendering when its background document becomes visible and then releases its temporary listener", async () => {
  const visibility = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  const callbacks: FrameRequestCallback[] = [], loops: boolean[] = [];
  let running = false;
  const pending = initializeSceneFrames({ setRenderLoop(value) { running = value; loops.push(value); }, presentationReady: () => running }, undefined, visibility,
    (callback) => { callbacks.push(callback); return callbacks.length; }, () => {});
  callbacks[0]!(0); expect(loops).toEqual([false]);
  visibility.visibilityState = "visible"; visibility.dispatchEvent(new Event("visibilitychange"));
  callbacks[1]!(16); callbacks[2]!(32); await pending; expect(loops).toEqual([false, true]);
  visibility.visibilityState = "hidden"; visibility.dispatchEvent(new Event("visibilitychange")); expect(loops).toEqual([false, true]);
});

test("an aborted background initialization cannot restart its retired renderer on a later visibility event", async () => {
  const visibility = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  const owner = new AbortController(), loops: boolean[] = [], cancelled: number[] = [];
  const pending = initializeSceneFrames({ setRenderLoop(value) { loops.push(value); }, presentationReady: () => false }, owner.signal, visibility, () => 1, (id) => { cancelled.push(id); });
  owner.abort(); await expect(pending).rejects.toThrow("cancelled");
  visibility.visibilityState = "visible"; visibility.dispatchEvent(new Event("visibilitychange"));
  expect(loops).toEqual([false, false]); expect(cancelled).toEqual([1]);
});
