import { expect, test } from "bun:test";
import { firstSceneFrames } from "./firstSceneFrames";

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
