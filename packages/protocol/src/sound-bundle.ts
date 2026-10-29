export const TABLE_SOUND_PATH = "runtime/presentation/table-sounds.json";
export const SOUND_BUNDLE_LIMIT = 384 * 1024;
export const SOUND_CUES = ["dice", "card", "shuffle", "place", "choice", "victory"] as const;
export type SoundCue = typeof SOUND_CUES[number];
export interface SoundClip {
  cue: SoundCue;
  title: string;
  dataUrl: string;
  sha256: string;
  source: { creator: string; url: string; file: string; sha256: string; license: "CC0-1.0" | "CC-BY-4.0"; licenseUrl: string; evidenceUrl: string; evidenceHash: string };
  processing: { tool: string; recipe: string; sourceHash: string; outputHash: string; rmsDb: number; peakDb: number; oversampledPeakDb: number; duration: number };
}
export interface SoundBundle { formatVersion: 1; id: string; version: number; title: string; clips: SoundClip[] }
export interface WaveStats { duration: number; samples: number; sampleRate: 48000; channels: 1; rmsDb: number; peakDb: number; edgePeak: number }
export function soundHash(bytes: Uint8Array, digest: (bytes: Uint8Array) => Uint8Array): string { return `sha256:${[...digest(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`; }

/** Full PCM container and signal admission, independent of a browser's tolerant decoder. */
export function inspectSoundWave(bytes: Uint8Array): WaveStats {
  const fail = () => { throw new Error("Use a complete, audible mono 48 kHz PCM16 WAV with quiet edges and peak headroom (at most 2 seconds)."); };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length < 44 || bytes.length > 192_128 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.length) return fail();
  let validFormat = false, pcm: Uint8Array | null = null;
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) return fail();
    const type = ascii(at, 4), n = view.getUint32(at + 4, true), end = at + 8 + n;
    if (end > bytes.length) return fail();
    if (type === "fmt ") {
      if (validFormat || n < 16 || view.getUint16(at + 8, true) !== 1 || view.getUint16(at + 10, true) !== 1 || view.getUint32(at + 12, true) !== 48000 || view.getUint32(at + 16, true) !== 96000 || view.getUint16(at + 20, true) !== 2 || view.getUint16(at + 22, true) !== 16) return fail();
      validFormat = true;
    } else if (type === "data") { if (pcm || n % 2) return fail(); pcm = bytes.subarray(at + 8, end); }
    at = end + n % 2;
    if (at > bytes.length) return fail();
  }
  if (!validFormat || !pcm || pcm.length < 2400 || pcm.length > 192000) return fail();
  const samples = pcm.length / 2, data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let power = 0, peak = 0, edgePeak = 0, total = 0;
  for (let i = 0; i < samples; i++) {
    const value = data.getInt16(i * 2, true) / 32768;
    power += value * value; total += value; peak = Math.max(peak, Math.abs(value));
    if (i < 24 || i >= samples - 24) edgePeak = Math.max(edgePeak, Math.abs(value));
  }
  const rmsDb = 10 * Math.log10(power / samples), peakDb = 20 * Math.log10(peak);
  if (!Number.isFinite(rmsDb) || rmsDb < -55 || peakDb > -1.4 || edgePeak > .025 || Math.abs(total / samples) > .02) return fail();
  return { duration: samples / 48000, samples, sampleRate: 48000, channels: 1, rmsDb, peakDb, edgePeak };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function soundBytes(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith("data:audio/wav;base64,")) throw new Error("Sound clips must embed a WAV; remote or executable URLs are not supported.");
  const value = dataUrl.slice(22);
  if (!value || value.length > 260_000 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("The sound data is incomplete or too large.");
  const bytes = new Uint8Array(value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const packed = BASE64.indexOf(value[i]!) * 262144 + BASE64.indexOf(value[i + 1]!) * 4096 + Math.max(0, BASE64.indexOf(value[i + 2]!)) * 64 + Math.max(0, BASE64.indexOf(value[i + 3]!));
    if (offset < bytes.length) bytes[offset++] = packed >>> 16;
    if (offset < bytes.length) bytes[offset++] = packed >>> 8 & 255;
    if (offset < bytes.length) bytes[offset++] = packed & 255;
  }
  return bytes;
}

function https(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
function text(value: unknown, max = 120): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function hash(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
export function parseSoundBundle(content: string, digest: (bytes: Uint8Array) => Uint8Array): SoundBundle {
  if (new TextEncoder().encode(content).length > SOUND_BUNDLE_LIMIT) throw new Error("Sound bundle exceeds 384 KiB.");
  let bundle: SoundBundle;
  try { bundle = JSON.parse(content) as SoundBundle; } catch { throw new Error("Choose a sound-bundle JSON file."); }
  if (!bundle || bundle.formatVersion !== 1 || !text(bundle.id, 64) || !/^[a-z0-9-]+$/.test(bundle.id) || !Number.isSafeInteger(bundle.version) || bundle.version < 1 || !text(bundle.title) || !Array.isArray(bundle.clips) || !bundle.clips.length || bundle.clips.length > 6) throw new Error("Invalid sound-bundle identity or version; use 1–6 clips.");
  const seen = new Set<SoundCue>();
  for (const clip of bundle.clips) {
    if (!clip || !SOUND_CUES.includes(clip.cue) || seen.has(clip.cue) || !text(clip.title) || typeof clip.dataUrl !== "string" || !hash(clip.sha256)) throw new Error("Each sound cue needs one named, hashed WAV.");
    seen.add(clip.cue);
    const s = clip.source, p = clip.processing;
    if (!s || !text(s.creator) || s.creator === "Unknown creator" || !text(s.file, 200) || !https(s.url) || !https(s.evidenceUrl) || !hash(s.sha256) || !hash(s.evidenceHash) || !["CC0-1.0", "CC-BY-4.0"].includes(s.license) || s.licenseUrl !== (s.license === "CC0-1.0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/licenses/by/4.0/")) throw new Error("Keep an identifiable creator, per-file license, original hash and license evidence with each clip.");
    const bytes = soundBytes(clip.dataUrl), stats = inspectSoundWave(bytes);
    if (soundHash(bytes, digest) !== clip.sha256) throw new Error("The sound bytes do not match their SHA-256.");
    if (!p || !text(p.tool, 200) || !text(p.recipe, 3000) || p.sourceHash !== s.sha256 || p.outputHash !== clip.sha256 || ![p.rmsDb, p.peakDb, p.oversampledPeakDb, p.duration].every(Number.isFinite) || p.oversampledPeakDb > -1.4 || Math.abs(p.rmsDb - stats.rmsDb) > .02 || Math.abs(p.peakDb - stats.peakDb) > .02 || Math.abs(p.duration - stats.duration) > .0001) throw new Error("The sound processing measurements are missing or inconsistent.");
  }
  return bundle;
}
