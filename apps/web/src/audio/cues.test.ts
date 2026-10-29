import { expect, test } from "bun:test";
import { cuesForEvents, renderCue, type SoundCue } from "./cues";
import type { KernelEvent } from "digipology-kernel";

test("action events produce bounded cues without sounding for unrelated game updates", () => {
  const events = ["die.rolled", "die.rolled", "counter.changed", "entity.flipped"].map((type) => ({ type, sequence: 1, actionId: "one", data: {} }) satisfies KernelEvent);
  expect(cuesForEvents(events)).toEqual(["dice", "card"]);
  expect(cuesForEvents([{ type: "script.error", sequence: 2, actionId: "error", data: {} }])).toEqual([]);
});

for (const cue of ["dice", "card", "shuffle", "place", "choice", "victory"] satisfies SoundCue[]) {
  test(`${cue} fallback sound has audible energy, headroom, and a quiet release`, () => {
    const samples = renderCue(cue);
    let energy = 0;
    let peak = 0;
    let total = 0;
    expect(samples.every(Number.isFinite)).toBe(true);
    for (const value of samples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); total += value; }
    expect(Math.sqrt(energy / samples.length)).toBeGreaterThan(0.003);
    expect(peak).toBeLessThanOrEqual(0.55);
    expect(Math.abs(total / samples.length)).toBeLessThan(0.003);
    expect(Math.abs(samples[0]!)).toBeLessThan(0.001);
    expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.001);
  });
}
