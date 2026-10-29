import { soundBytes, type SoundBundle } from "digipology-protocol";
import { parseSoundBundle } from "./bundle";
import { renderCue, type SoundCue } from "./cues";

export const DEFAULT_SOUND_BUNDLE = "/audio/table-effects/v1/bundle.json";
export interface AudioStatus { state: "loading" | "locked" | "ready" | "failed" | "unavailable"; bundle: SoundBundle | null; error: string | null }

export class TableAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly buffers = new Map<SoundCue, AudioBuffer>();
  private readonly simple = new Map<SoundCue, AudioBuffer>();
  private readonly voices = new Map<AudioBufferSourceNode, GainNode>();
  private closed = false;
  private visible = true;
  private volume = .65;
  private muted = false;
  private generation = 0;
  private decoding: Promise<void> | null = null;
  private activation: Promise<void> | null = null;
  private activityEpoch = 0;
  private readonly waiting = new Set<object>();
  private status: AudioStatus = { state: "loading", bundle: null, error: null };
  constructor(private readonly changed: (status: AudioStatus) => void = () => {}) {}
  private update(next: AudioStatus): void { if (!this.closed) { this.status = next; this.changed(next); } }

  async loadBundle(content: string | null): Promise<void> {
    const generation = ++this.generation;
    this.stopVoices(); this.buffers.clear(); this.decoding = null;
    this.update({ state: "loading", bundle: null, error: null });
    try {
      let raw = content;
      if (raw === null) {
        const response = await fetch(DEFAULT_SOUND_BUNDLE, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Sound download failed (${response.status}).`);
        const reader = response.body?.getReader(); if (!reader) throw new Error("Sound download was empty.");
        const chunks: Uint8Array[] = []; let count = 0;
        while (true) { const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.length; if (count > 384 * 1024) { await reader.cancel(); throw new Error("Sound download exceeds its budget."); } chunks.push(chunk.value); }
        const bytes = new Uint8Array(count); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      const bundle = parseSoundBundle(raw);
      if (this.closed || generation !== this.generation) return;
      this.update({ state: "locked", bundle, error: null });
      if (this.context) await this.decode();
    } catch (error) {
      if (generation === this.generation) this.update({ state: "failed", bundle: null, error: error instanceof Error ? error.message : "Source sounds could not load." });
    }
  }
  private decode(): Promise<void> {
    if (this.decoding) return this.decoding;
    const context = this.context, bundle = this.status.bundle, generation = this.generation;
    if (!context || !bundle) return Promise.resolve();
    this.decoding = (async () => {
      try {
        const buffers = await Promise.all(bundle.clips.map(async (clip) => {
          const bytes = soundBytes(clip.dataUrl);
          const buffer = await context.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
          if (!buffer.length || buffer.numberOfChannels !== 1 || Math.abs(buffer.duration - clip.processing.duration) > .01) throw new Error("A source clip decoded with incomplete duration or channels.");
          let energy = 0;
          for (const sample of buffer.getChannelData(0)) { if (!Number.isFinite(sample) || Math.abs(sample) > .9) throw new Error("A source clip decoded without safe headroom."); energy += sample * sample; }
          if (energy / buffer.length < .000001) throw new Error("A source clip decoded without audible signal.");
          return [clip.cue, buffer] as const;
        }));
        if (this.closed || generation !== this.generation) return;
        for (const [cue, buffer] of buffers) this.buffers.set(cue, buffer);
        this.update({ state: "ready", bundle, error: null });
      } catch (error) {
        if (generation === this.generation) { this.buffers.clear(); this.update({ state: "failed", bundle, error: error instanceof Error ? error.message : "Sound decoding failed." }); }
      }
    })();
    return this.decoding;
  }
  setLevel(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : .65));
    this.muted = muted; if (muted) this.stopVoices();
    if (this.context && this.output) this.output.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, .02);
  }
  unlock(): Promise<void> {
    if (this.activation) return this.activation;
    this.activation = this.activate().finally(() => { this.activation = null; });
    return this.activation;
  }
  private async activate(): Promise<void> {
    if (this.closed || !this.visible) return;
    if (typeof AudioContext === "undefined") { this.update({ ...this.status, state: "unavailable", error: "This browser does not support table sounds." }); return; }
    try {
      if (!this.context) {
        this.context = new AudioContext({ sampleRate: 48000 }); this.output = this.context.createGain(); this.output.gain.value = this.muted ? 0 : this.volume;
        this.output.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
      if (this.status.state === "locked") await this.decode();
    } catch { this.update({ ...this.status, state: "failed", error: "Sound activation failed. Try again with a click or key press." }); }
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) { this.stopVoices(); void this.context?.suspend().catch(() => {}); }
  }
  stopVoices(): void {
    this.activityEpoch++; this.waiting.clear();
    for (const [voice, gain] of this.voices) { voice.onended = null; try { voice.stop(); } catch {} voice.disconnect(); gain.disconnect(); }
    this.voices.clear();
  }
  play(cue: SoundCue): "imported" | "simple" | "queued" | null {
    const context = this.context;
    if (this.closed || !this.visible || this.muted || this.volume === 0 || !context || !this.output || this.voices.size >= 3) return null;
    if (this.activation && (context.state !== "running" || this.status.state === "locked")) {
      if (this.waiting.size >= 3) return null;
      const token = {}, epoch = this.activityEpoch, requested = performance.now(); this.waiting.add(token);
      void this.activation.then(() => {
        const current = this.waiting.delete(token);
        // Only the cue accompanying this gesture may wait briefly. Seat, source,
        // mute, visibility and transport changes invalidate it; no backlog replay.
        if (current && epoch === this.activityEpoch && performance.now() - requested < 400) this.play(cue);
      });
      return "queued";
    }
    if (context.state !== "running") return null;
    const imported = this.buffers.get(cue);
    let buffer = imported ?? this.simple.get(cue);
    if (!buffer) { const pcm = renderCue(cue, context.sampleRate); buffer = context.createBuffer(1, pcm.length, context.sampleRate); buffer.getChannelData(0).set(pcm); this.simple.set(cue, buffer); }
    const voice = context.createBufferSource(), gain = context.createGain(); voice.buffer = buffer;
    // Three voices at 0.3 keep coincident admitted peaks below full scale.
    gain.gain.value = .3; voice.connect(gain).connect(this.output); this.voices.set(voice, gain);
    voice.onended = () => { this.voices.delete(voice); voice.disconnect(); gain.disconnect(); };
    voice.start(); return imported ? "imported" : "simple";
  }
  async dispose(): Promise<void> {
    this.closed = true; this.generation++; this.stopVoices(); this.buffers.clear(); this.simple.clear();
    await this.context?.close().catch(() => {}); this.context = null; this.output = null;
  }
}
