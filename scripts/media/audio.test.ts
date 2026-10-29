import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, masterAudio } from "./audio";
import { fetchAsset } from "./assets";
import { inspectSoundWave } from "digipology-protocol";

test("FFmpeg masters a real clip with measured loudness, 48kHz output and peak headroom", async () => {
  const dir = await mkdtemp(join(tmpdir(), "digipology-audio-test-"));
  try {
    const input = join(dir, "quiet.wav");
    const output = join(dir, "master.wav");
    await command(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=44100", "-af", "volume=0.2", input]);
    const report = await masterAudio(input, output, "music", true);
    expect(report.normalization).toBe("ebu-r128");
    expect(report.output.sampleRate).toBe(48_000);
    expect(report.output.channels).toBe(2);
    expect(report.output.duration).toBeGreaterThan(1.8);
    const decoded = await command(["ffmpeg", "-hide_banner", "-i", output, "-af", "volumedetect", "-f", "null", "-"]);
    const peak = Number(decoded.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThanOrEqual(-1.4);
    await expect(masterAudio(input, output, "music")).rejects.toThrow("overwrite");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20_000);

test("effect edge trimming preserves separated attacks and their interior pause, and rejects silence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "digipology-edges-test-"));
  try {
    const input = join(dir, "two-attacks.wav"), output = join(dir, "master.wav");
    await command(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.1", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.15:sample_rate=48000", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.2", "-f", "lavfi", "-i", "sine=frequency=880:duration=0.15:sample_rate=48000", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.1", "-filter_complex", "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[out]", "-map", "[out]", input]);
    await masterAudio(input, output, "effect");
    const bytes = new Uint8Array(await Bun.file(output).arrayBuffer()), stats = inspectSoundWave(bytes);
    expect(stats.duration).toBeGreaterThan(.45); expect(stats.duration).toBeLessThan(.6);
    const start = Buffer.from(bytes).indexOf("data") + 8, view = new DataView(bytes.buffer);
    const energy = (from: number, to: number) => { let sum = 0, n = 0; for (let i = Math.floor(from * 48000); i < Math.floor(to * 48000); i++) { sum += (view.getInt16(start + i * 2, true) / 32768) ** 2; n++; } return Math.sqrt(sum / n); };
    expect(energy(.04, .1)).toBeGreaterThan(.01); expect(energy(.24, .29)).toBeLessThan(.001); expect(energy(stats.duration - .1, stats.duration - .04)).toBeGreaterThan(.01);
    const silence = join(dir, "silence.wav"); await command(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.2", silence]);
    await expect(masterAudio(silence, join(dir, "empty.wav"), "effect")).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20_000);

test("short sound effects use measured transient normalization rather than invalid LUFS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "digipology-transient-test-"));
  try {
    const input = join(dir, "click.wav");
    await command(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=180:duration=0.15:sample_rate=48000", input]);
    const downloaded = join(dir, "downloaded.wav");
    const provenance = await fetchAsset({ id: "test", title: "Click", kind: "audio", provider: "openverse", sourceUrl: "https://freesound.org/s/1/", downloadUrl: "https://cdn.freesound.org/click.wav", creator: "Artist", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", attribution: "Click — Artist, CC0" }, downloaded, async () => new Response(await Bun.file(input).arrayBuffer()));
    expect(provenance.audio?.sampleRate).toBe(48_000);
    expect(provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    const result = await masterAudio(input, join(dir, "master.ogg"), "effect");
    expect(result.normalization).toBe("transient-rms");
    expect(result.targetLufs).toBeNull();
    expect(result.output.duration).toBeLessThan(0.25);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20_000);
