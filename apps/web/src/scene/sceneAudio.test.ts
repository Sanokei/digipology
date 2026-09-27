import { expect, test } from "bun:test";
import { scheduleSceneSound } from "./sceneAudio";

test("audio scheduler builds tactile cues without an AudioContext", () => {
  expect(scheduleSceneSound("card-flip", 4)).toEqual([
    { at: 4, duration: 0.07, frequency: 1_600, endFrequency: 420, gain: 0.11, wave: "noise" },
    { at: 4.055, duration: 0.045, frequency: 250, endFrequency: 180, gain: 0.08, wave: "triangle" },
  ]);
  expect(scheduleSceneSound("deck-shuffle")).toHaveLength(10);
  expect(scheduleSceneSound("dice-rattle")).toHaveLength(7);
  expect(scheduleSceneSound("your-turn").at(-1)?.at).toBe(0.16);
});

test("every scheduled envelope is finite, forward, and non-silent", () => {
  const sounds = [
    "card-slide", "card-flip", "deck-shuffle", "dice-rattle", "dice-land", "piece-pick",
    "piece-place", "chip-clink", "button-click", "chat-blip", "your-turn",
  ] as const;
  for (const sound of sounds) {
    for (const event of scheduleSceneSound(sound, 2)) {
      expect(Number.isFinite(event.at)).toBeTrue();
      expect(event.at).toBeGreaterThanOrEqual(2);
      expect(event.duration).toBeGreaterThan(0);
      expect(event.gain).toBeGreaterThan(0);
    }
  }
});
