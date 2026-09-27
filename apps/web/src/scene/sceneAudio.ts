import type { PresentationSettingsSource } from "./sceneAdapter";

export type SceneSound =
  | "card-slide"
  | "card-flip"
  | "deck-shuffle"
  | "dice-rattle"
  | "dice-land"
  | "piece-pick"
  | "piece-place"
  | "chip-clink"
  | "button-click"
  | "chat-blip"
  | "your-turn";

export interface ScheduledTone {
  readonly at: number;
  readonly duration: number;
  readonly frequency: number;
  readonly endFrequency: number;
  readonly gain: number;
  readonly wave: OscillatorType | "noise";
}

const tone = (
  at: number,
  duration: number,
  frequency: number,
  endFrequency: number,
  gain: number,
  wave: ScheduledTone["wave"] = "sine",
): ScheduledTone => ({ at, duration, frequency, endFrequency, gain, wave });

/** Pure scheduling data, separately testable without an AudioContext. */
export function scheduleSceneSound(sound: SceneSound, start = 0): readonly ScheduledTone[] {
  const at = (offset: number) => start + offset;
  switch (sound) {
    case "card-slide": return [tone(at(0), 0.11, 820, 240, 0.13, "noise")];
    case "card-flip": return [tone(at(0), 0.07, 1_600, 420, 0.11, "noise"), tone(at(0.055), 0.045, 250, 180, 0.08, "triangle")];
    case "deck-shuffle": return Array.from({ length: 10 }, (_, index) => tone(at(index * 0.028), 0.055, 1_100 - index * 43, 350, 0.055, "noise"));
    case "dice-rattle": return Array.from({ length: 7 }, (_, index) => tone(at(index * 0.045), 0.035, 190 + (index % 3) * 80, 120, 0.085, index % 2 === 0 ? "square" : "noise"));
    case "dice-land": return [tone(at(0), 0.11, 145, 78, 0.19, "triangle"), tone(at(0.035), 0.07, 620, 280, 0.07, "noise")];
    case "piece-pick": return [tone(at(0), 0.06, 170, 260, 0.1, "triangle")];
    case "piece-place": return [tone(at(0), 0.1, 210, 82, 0.16, "triangle")];
    case "chip-clink": return [tone(at(0), 0.12, 1_580, 1_100, 0.1, "sine"), tone(at(0.018), 0.09, 2_240, 1_600, 0.06, "sine")];
    case "button-click": return [tone(at(0), 0.045, 480, 240, 0.08, "square")];
    case "chat-blip": return [tone(at(0), 0.08, 660, 820, 0.07, "sine")];
    case "your-turn": return [tone(at(0), 0.18, 523.25, 659.25, 0.08), tone(at(0.16), 0.28, 659.25, 783.99, 0.09)];
  }
}

export interface SceneAudio {
  resume(): Promise<void>;
  play(sound: SceneSound): void;
  dispose(): void;
}

type AudioContextConstructor = new () => AudioContext;

export function createSceneAudio(
  settings: PresentationSettingsSource,
  createContext: (() => AudioContext) | undefined = typeof AudioContext === "undefined"
    ? undefined
    : () => new (AudioContext as unknown as AudioContextConstructor)(),
): SceneAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let disposed = false;

  const ensureContext = (): AudioContext | null => {
    if (disposed || createContext === undefined) return null;
    if (context !== null) return context;
    context = createContext();
    master = context.createGain();
    master.connect(context.destination);
    return context;
  };

  return {
    async resume() {
      const preferences = settings.getSnapshot();
      if (preferences.muted || preferences.reducedAudio || preferences.volume <= 0) return;
      const target = ensureContext();
      if (target !== null && target.state === "suspended") await target.resume();
    },
    play(sound) {
      const preferences = settings.getSnapshot();
      if (preferences.muted || preferences.reducedAudio || preferences.volume <= 0) return;
      const target = ensureContext();
      if (target === null || target.state !== "running" || master === null) return;
      master.gain.setValueAtTime(preferences.volume, target.currentTime);
      for (const scheduled of scheduleSceneSound(sound, target.currentTime)) {
        const envelope = target.createGain();
        envelope.gain.setValueAtTime(0.0001, scheduled.at);
        envelope.gain.exponentialRampToValueAtTime(Math.max(scheduled.gain, 0.0001), scheduled.at + 0.006);
        envelope.gain.exponentialRampToValueAtTime(0.0001, scheduled.at + scheduled.duration);
        envelope.connect(master);
        if (scheduled.wave === "noise") {
          const frameCount = Math.max(1, Math.ceil(target.sampleRate * scheduled.duration));
          const buffer = target.createBuffer(1, frameCount, target.sampleRate);
          const data = buffer.getChannelData(0);
          // Deterministic filtered noise is plenty for tactile paper/wood transients.
          let previous = 0;
          for (let index = 0; index < data.length; index += 1) {
            const white = ((index * 1_103_515_245 + 12_345) % 65_536) / 32_768 - 1;
            previous = previous * 0.62 + white * 0.38;
            data[index] = previous;
          }
          const source = target.createBufferSource();
          source.buffer = buffer;
          const filter = target.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.setValueAtTime(scheduled.frequency, scheduled.at);
          filter.frequency.exponentialRampToValueAtTime(Math.max(scheduled.endFrequency, 1), scheduled.at + scheduled.duration);
          source.connect(filter).connect(envelope);
          source.start(scheduled.at);
          source.stop(scheduled.at + scheduled.duration);
        } else {
          const oscillator = target.createOscillator();
          oscillator.type = scheduled.wave;
          oscillator.frequency.setValueAtTime(scheduled.frequency, scheduled.at);
          oscillator.frequency.exponentialRampToValueAtTime(Math.max(scheduled.endFrequency, 1), scheduled.at + scheduled.duration);
          oscillator.connect(envelope);
          oscillator.start(scheduled.at);
          oscillator.stop(scheduled.at + scheduled.duration);
        }
      }
    },
    dispose() {
      disposed = true;
      const closing = context;
      context = null;
      master = null;
      if (closing !== null) void closing.close();
    },
  };
}
