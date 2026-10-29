import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

export async function command(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (code !== 0) throw new Error(`${args[0]} failed (exit ${code}): ${stderr.slice(-1500)}`);
  return { stdout, stderr };
}

export async function probeAudio(path: string): Promise<{ duration: number; sampleRate: number; channels: number }> {
  const data = JSON.parse((await command(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", resolve(path)])).stdout);
  const stream = data.streams?.find((item: { codec_type: string }) => item.codec_type === "audio");
  const duration = Number(data.format?.duration ?? stream?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error("Audio must contain a decodable track of at most ten minutes");
  return { duration, sampleRate: Number(stream.sample_rate), channels: Number(stream.channels) };
}

function loudness(stderr: string): Record<string, string> {
  const blocks = stderr.match(/\{[^{}]+\}/g) ?? [];
  for (const block of blocks.reverse()) {
    const value = JSON.parse(block);
    if (typeof value.input_i === "string") return value;
  }
  throw new Error("FFmpeg did not report loudness measurements");
}

export async function masterAudio(input: string, output: string, profile: "effect" | "music", loop = false) {
  const original = await probeAudio(input);
  const extension = extname(output).toLowerCase();
  const codec = extension === ".wav" ? ["-c:a", "pcm_s16le"] : extension === ".ogg" ? ["-c:a", "libvorbis", "-q:a", "5"] : extension === ".opus" ? ["-c:a", "libopus", "-b:a", "128k"] : null;
  if (!codec) throw new Error("Mastered audio output must be WAV, Ogg Vorbis, or Opus");
  if (await Bun.file(output).exists() || await Bun.file(`${output}.json`).exists()) throw new Error("Refusing to overwrite an existing master or processing report");
  const temporary = await mkdtemp(join(tmpdir(), "digipology-master-"));
  const trimmed = join(temporary, "trimmed.wav");
  const target = profile === "music" ? -24 : -20;
  try {
    const trim = "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-55dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_duration=0.01:start_threshold=-55dB:start_silence=0.02,areverse";
    await command(["ffmpeg", "-hide_banner", "-v", "error", "-nostdin", "-n", "-protocol_whitelist", "file,pipe", "-i", resolve(input), "-vn", "-af", trim, "-ar", "48000", "-ac", profile === "music" ? "2" : "1", "-c:a", "pcm_f32le", trimmed]);
    const cleaned = await probeAudio(trimmed);
    let normalization: string;
    let measured: Record<string, string> | null = null;
    let method: "ebu-r128" | "transient-rms";
    if (cleaned.duration >= 0.4) {
      measured = loudness((await command(["ffmpeg", "-hide_banner", "-nostdin", "-i", trimmed, "-af", `loudnorm=I=${target}:TP=-1.5:LRA=7:print_format=json`, "-f", "null", "-"])).stderr);
    }
    if (measured && [measured.input_i, measured.input_tp, measured.input_lra, measured.input_thresh, measured.target_offset].every((value) => Number.isFinite(Number(value)))) {
      normalization = `loudnorm=I=${target}:TP=-1.5:LRA=7:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
      method = "ebu-r128";
    } else {
      const stats = (await command(["ffmpeg", "-hide_banner", "-nostdin", "-i", trimmed, "-af", "volumedetect", "-f", "null", "-"])).stderr;
      const rms = Number(stats.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
      const peak = Number(stats.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
      if (!Number.isFinite(rms) || !Number.isFinite(peak) || peak < -80) throw new Error("Audio has no useful audible signal");
      normalization = `volume=${Math.min(-22 - rms, -1.5 - peak)}dB`;
      method = "transient-rms";
    }
    const fade = Math.min(loop ? 0.05 : 0.015, cleaned.duration / 4);
    const filters = `${normalization},afade=t=in:d=${fade},afade=t=out:st=${cleaned.duration - fade}:d=${fade},alimiter=limit=0.84:level=false`;
    await mkdir(dirname(resolve(output)), { recursive: true });
    await command(["ffmpeg", "-hide_banner", "-v", "error", "-nostdin", "-n", "-i", trimmed, "-vn", "-af", filters, "-ar", "48000", ...codec, resolve(output)]);
    const result = await probeAudio(output);
    const report = { profile, loop, normalization: method, targetLufs: method === "ebu-r128" ? target : null, truePeakCeilingDb: -1.5, input: original, output: result, measured, sourceHash: new Bun.CryptoHasher("sha256").update(await Bun.file(input).arrayBuffer()).digest("hex"), outputHash: new Bun.CryptoHasher("sha256").update(await Bun.file(output).arrayBuffer()).digest("hex") };
    await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
