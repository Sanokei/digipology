import { renderCue, type SoundCue } from "./cues";

export class TableAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly buffers = new Map<SoundCue, AudioBuffer>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private closed = false;
  private volume = 0.65;
  private muted = false;

  setLevel(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.65));
    this.muted = muted;
    if (this.context && this.output) this.output.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.02);
  }

  async unlock(): Promise<void> {
    if (this.closed || typeof AudioContext === "undefined") return;
    try {
      if (this.context === null) {
        this.context = new AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = this.muted ? 0 : this.volume;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.ratio.value = 12;
        this.output.connect(limiter).connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch { /* Audio availability must never interrupt a game. */ }
  }

  play(cue: SoundCue): void {
    const context = this.context;
    if (this.closed || this.muted || !context || !this.output || context.state !== "running" || this.voices.size >= 6) return;
    let buffer = this.buffers.get(cue);
    if (!buffer) {
      const pcm = renderCue(cue, context.sampleRate);
      buffer = context.createBuffer(1, pcm.length, context.sampleRate);
      buffer.getChannelData(0).set(pcm);
      this.buffers.set(cue, buffer);
    }
    const voice = context.createBufferSource();
    voice.buffer = buffer;
    voice.connect(this.output);
    this.voices.add(voice);
    voice.onended = () => { this.voices.delete(voice); voice.disconnect(); };
    voice.start();
  }

  async dispose(): Promise<void> {
    this.closed = true;
    for (const voice of this.voices) { voice.onended = null; voice.stop(); voice.disconnect(); }
    this.voices.clear();
    this.buffers.clear();
    await this.context?.close().catch(() => {});
    this.context = null;
    this.output = null;
  }
}
