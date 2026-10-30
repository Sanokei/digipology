import { expect, test } from "bun:test";
import { SoftwareFrameBudget, SoftwareGpuFrame } from "./softwareFrameBudget";

test("software tables stop saturating the GPU while idle but repaint a new action on the next engine frame", () => {
  const budget = new SoftwareFrameBudget(); budget.wake(0);
  expect(Array.from({ length: 31 }, (_, i) => budget.shouldDraw(i * 33)).every(Boolean)).toBe(true);
  let idleDraws = 0;
  for (let t = 1_500; t < 3_500; t += 33) if (budget.shouldDraw(t)) idleDraws++;
  expect(idleDraws).toBeLessThanOrEqual(4); expect(idleDraws).toBeGreaterThan(0);
  budget.wake(3_600); expect(budget.shouldDraw(3_600)).toBe(true); expect(budget.shouldDraw(3_633)).toBe(true);
  expect(budget.deltaMs).toBe(33);
  expect(budget.shouldDraw(10_000, true)).toBe(true); expect(budget.shouldDraw(10_033, true)).toBe(true);
});

test("software frames never block or queue behind an unfinished GPU frame and delete owned fences", () => {
  const fence = {} as WebGLSync, deleted: WebGLSync[] = [], waits: number[][] = [];
  let status = 1, flushes = 0;
  const gl = { TIMEOUT_EXPIRED: 1, WAIT_FAILED: 2, SYNC_GPU_COMMANDS_COMPLETE: 3,
    fenceSync: () => fence, flush: () => { flushes++; },
    clientWaitSync: (_sync: WebGLSync, flags: number, timeout: number) => { waits.push([flags, timeout]); return status; },
    deleteSync: (sync: WebGLSync) => deleted.push(sync) } as unknown as WebGL2RenderingContext;
  const frame = new SoftwareGpuFrame(gl); expect(frame.available()).toBe(true); frame.submitted();
  expect(frame.available()).toBe(false); expect(frame.completed).toBe(false); expect(waits).toEqual([[0, 0]]); expect(flushes).toBe(1);
  status = 4; expect(frame.available()).toBe(true); expect(frame.completed).toBe(true); expect(deleted).toEqual([fence]);
  frame.submitted(); frame.dispose(); frame.dispose(); expect(deleted).toEqual([fence, fence]);
});

test("unavailable synchronization falls back to ordinary rendering rather than wedging the table", () => {
  const frame = new SoftwareGpuFrame({ fenceSync: () => null } as unknown as WebGL2RenderingContext);
  frame.submitted(); expect(frame.available()).toBe(true); expect(frame.completed).toBe(true); frame.dispose();
});
