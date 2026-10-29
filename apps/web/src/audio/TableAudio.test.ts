import { expect, test } from "bun:test";
import { TableAudio } from "./TableAudio";

const content = await Bun.file(new URL("../../public/audio/table-effects/v1/bundle.json", import.meta.url)).text();
class FakeContext {
  static current: FakeContext;
  readonly sampleRate = 48000;
  readonly destination = {};
  currentTime = 0;
  state: AudioContextState = "suspended";
  starts: number[] = [];
  private releaseResume: (() => void) | null = null;
  constructor() { FakeContext.current = this; }
  resume() { return new Promise<void>((resolve) => { this.releaseResume = () => { if (this.state !== "closed") this.state = "running"; resolve(); }; }); }
  release() { this.releaseResume?.(); }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
  createGain() { return { gain: { value: 1, setTargetAtTime(value: number) { this.value = value; } }, connect(node: unknown) { return node; }, disconnect() {} }; }
  createBuffer(channels: number, samples: number, sampleRate: number, pcm = new Float32Array(samples)) { return { length: samples, numberOfChannels: channels, sampleRate, duration: samples / sampleRate, getChannelData: () => pcm }; }
  async decodeAudioData(data: ArrayBuffer) {
    const bytes = Buffer.from(data); let pcm = bytes.subarray(44);
    for (let at = 12; at < bytes.length;) { const n = bytes.readUInt32LE(at + 4); if (bytes.toString("ascii", at, at + 4) === "data") { pcm = bytes.subarray(at + 8, at + 8 + n); break; } at += 8 + n + n % 2; }
    return this.createBuffer(1, pcm.length / 2, 48000, Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768));
  }
  createBufferSource() { const owner = this; return { buffer: null as AudioBuffer | null, onended: null as (() => void) | null, connect(node: unknown) { return node; }, disconnect() {}, stop() {}, start() { owner.starts.push(this.buffer!.length); } }; }
}
async function fake(run: (engine: TableAudio) => Promise<void>) {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const engine = new TableAudio();
  try { await engine.loadBundle(content); await run(engine); }
  finally { await engine.dispose(); globalThis.AudioContext = previous; }
}
test("the first confirmed cue waits for its user-gesture resume and uses the imported buffer", async () => {
  await fake(async (engine) => {
    const activating = engine.unlock(); engine.play("dice");
    expect(FakeContext.current.starts).toEqual([]);
    FakeContext.current.release(); await activating; await Promise.resolve();
    expect(FakeContext.current.starts).toEqual([34729]);
    engine.play("card"); engine.play("choice"); engine.play("dice");
    expect(FakeContext.current.starts).toHaveLength(3); // bounded simultaneous mix
  });
});
test("mute, a seat-change stop and hidden state cancel pending activation cues", async () => {
  for (const cancel of [(engine: TableAudio) => engine.setLevel(.65, true), (engine: TableAudio) => engine.stopVoices(), (engine: TableAudio) => engine.setVisible(false)]) {
    await fake(async (engine) => {
      const activating = engine.unlock(); engine.play("card"); cancel(engine);
      FakeContext.current.release(); await activating; await Promise.resolve();
      expect(FakeContext.current.starts).toEqual([]);
    });
  }
});
