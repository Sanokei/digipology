import type { KernelEvent } from "digipology-kernel";

export type SoundCue = "dice" | "card" | "shuffle" | "place" | "choice" | "victory";
const EVENT_CUES: Readonly<Record<string, SoundCue>> = {
  "die.rolled": "dice", "entity.flipped": "card", "deck.drawn": "card",
  "deck.shuffled": "shuffle", "entity.dropped": "place", "snap.attached": "place", "prompt.created": "choice",
};

export function cuesForEvents(events: readonly KernelEvent[]): SoundCue[] {
  return [...new Set(events.map((event) => EVENT_CUES[event.type]).filter((cue): cue is SoundCue => cue !== undefined))].slice(0, 3);
}

/** Small, bounded fallback Foley. Imported mastered clips can replace these without touching gameplay. */
export function renderCue(cue: SoundCue, sampleRate = 48_000): Float32Array {
  const duration = cue === "victory" ? 1.1 : cue === "dice" ? 0.48 : cue === "shuffle" ? 0.38 : 0.16;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let noise = 0x42f00d;
  let filtered = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
    const white = ((noise >>> 0) / 0xffff_ffff) * 2 - 1;
    filtered += 0.18 * (white - filtered);
    const attack = Math.min(1, time / 0.003);
    const release = Math.min(1, (duration - time) / 0.018);
    let value: number;
    if (cue === "victory" || cue === "choice") {
      const notes = cue === "victory" ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 783.99];
      value = notes.reduce((sum, frequency, note) => {
        const since = time - note * (cue === "victory" ? 0.12 : 0.045);
        return sum + (since < 0 ? 0 : Math.sin(2 * Math.PI * frequency * since) * Math.exp(-since * 7) * Math.min(1, since / 0.004));
      }, 0) * 0.16;
    } else {
      const gap = cue === "dice" ? 0.072 : cue === "shuffle" ? 0.042 : duration;
      const since = time % gap;
      const decay = Math.exp(-since * (cue === "card" ? 40 : 90)) * Math.exp(-time * 3);
      const tone = cue === "dice" || cue === "place" ? Math.sin(2 * Math.PI * 190 * since) * 0.25 : 0;
      value = (filtered * 0.6 + tone) * decay * 0.5;
    }
    samples[index] = Math.max(-0.55, Math.min(0.55, value * attack * release));
  }
  return samples;
}
