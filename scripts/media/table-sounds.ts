import { mkdtemp, mkdir, readFile, writeFile, rm, cp, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inspectSoundWave, parseSoundBundle, soundHash as hash, type SoundBundle, type SoundCue } from "digipology-protocol";
import { sha256 } from "digipology-canonical-json";
import { command, masterAudio } from "./audio";

interface SourceFile { path: string; sha256: string }
const soundHash = (bytes: Uint8Array) => hash(bytes, sha256);
interface SourceManifest {
  id: string; version: number; title: string; repository: string; commit: string;
  creator: string; license: "CC0-1.0"; licenseUrl: string;
  evidence: SourceFile[]; clips: (SourceFile & { cue: SoundCue; title: string })[];
}
export async function buildTableSounds(manifestPath: string, output: string, sourceCache?: string): Promise<SoundBundle> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SourceManifest;
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.git$/.test(manifest.repository) || !/^[a-f0-9]{40}$/.test(manifest.commit) || !manifest.evidence?.length || !manifest.clips?.length || manifest.clips.length > 6) throw new Error("Use an audited HTTPS creator Git manifest with a full pinned commit and license evidence.");
  for (const file of [...manifest.evidence, ...manifest.clips]) if (!/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(file.path) || file.path.split("/").includes("..") || !/^sha256:[0-9a-f]{64}$/.test(file.sha256)) throw new Error("Invalid pinned source path or expected hash.");
  if (await stat(output).then(() => true, () => false)) throw new Error("Refusing to overwrite an existing sound bundle directory.");
  const temporary = await mkdtemp(join(tmpdir(), "digipology-sounds-"));
  const repository = sourceCache ? resolve(sourceCache) : join(temporary, "creator");
  const pack = join(temporary, "pack");
  let createdOutput = false;
  try {
    if (!sourceCache) {
      await command(["git", "clone", "--filter=blob:none", "--no-checkout", "--depth", "1", manifest.repository, repository]);
      await command(["git", "-C", repository, "fetch", "--depth", "1", "origin", manifest.commit]);
    }
    const remote = (await command(["git", "-C", repository, "remote", "get-url", "origin"])).stdout.trim();
    if (remote !== manifest.repository) throw new Error("The source cache belongs to another creator repository.");
    await mkdir(join(pack, "originals"), { recursive: true }); await mkdir(join(pack, "clips")); await mkdir(join(pack, "provenance"));
    const read = async (file: SourceFile): Promise<Uint8Array> => {
      const process = Bun.spawn(["git", "-C", repository, "show", `${manifest.commit}:${file.path}`], { stdout: "pipe", stderr: "pipe" });
      const [code, data, error] = await Promise.all([process.exited, new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text()]);
      const bytes = new Uint8Array(data);
      if (code !== 0) throw new Error(`Creator source could not be read: ${file.path}: ${error.slice(-500)}`);
      if (bytes.length > 2 * 1024 * 1024 || soundHash(bytes) !== file.sha256) throw new Error(`Source/license SHA-256 mismatch: ${file.path}`);
      return bytes;
    };
    for (const file of manifest.evidence) await writeFile(join(pack, "provenance", file.path.replaceAll("/", "_")), await read(file));
    const base = manifest.repository.replace(/\.git$/, "") + `/blob/${manifest.commit}/`;
    const version = (await command(["ffmpeg", "-version"])).stdout;
    const tool = version.split("\n")[0]!.slice(0, 200);
    await writeFile(join(pack, "provenance", "toolchain.txt"), version + "\n" + (await command(["ffprobe", "-version"])).stdout);
    const clips: SoundBundle["clips"] = [];
    for (const file of manifest.clips) {
      const original = join(pack, "originals", `${file.cue}.ogg`), master = join(pack, "clips", `${file.cue}.wav`);
      await writeFile(original, await read(file));
      const report = await masterAudio(original, master, "effect");
      const bytes = new Uint8Array(await readFile(master)), stats = inspectSoundWave(bytes);
      const measured = (await command(["ffmpeg", "-hide_banner", "-nostdin", "-xerror", "-err_detect", "explode", "-i", master, "-af", "aresample=192000,astats=metadata=0:reset=0", "-f", "null", "-"])).stderr;
      const oversampledPeakDb = Number([...measured.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].at(-1)?.[1]);
      if (!Number.isFinite(oversampledPeakDb) || oversampledPeakDb > -1.4) throw new Error(`Master lacks measured peak headroom: ${file.path}`);
      clips.push({ cue: file.cue, title: file.title, dataUrl: `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}`, sha256: soundHash(bytes),
        source: { creator: manifest.creator, url: base + file.path, file: file.path, sha256: file.sha256, license: manifest.license, licenseUrl: manifest.licenseUrl, evidenceUrl: base + manifest.evidence[0]!.path, evidenceHash: manifest.evidence[0]!.sha256 },
        processing: { tool, recipe: `master-audio effect: edge silence -55dB/10ms (20ms retained); 48kHz mono; ${report.normalization}; target ${report.targetLufs ?? "transient RMS -22 dBFS"}; peak ceiling -1.5 dB; fade min(15ms,duration/4); limiter 0.84; PCM16 WAV; 4x oversampled output peak validation`, sourceHash: file.sha256, outputHash: soundHash(bytes), rmsDb: stats.rmsDb, peakDb: stats.peakDb, oversampledPeakDb, duration: stats.duration } });
    }
    const bundle: SoundBundle = { formatVersion: 1, id: manifest.id, version: manifest.version, title: manifest.title, clips };
    const content = JSON.stringify(bundle, null, 2) + "\n";
    parseSoundBundle(content, sha256);
    await writeFile(join(pack, "bundle.json"), content);
    await cp(manifestPath, join(pack, "provenance", "source-manifest.json"));
    await writeFile(join(pack, "provenance", "acquisition.json"), JSON.stringify({ repository: manifest.repository, commit: manifest.commit, method: sourceCache ? "verified previously acquired HTTPS Git cache" : "normal HTTPS Git clone and pinned fetch", bundleHash: soundHash(new TextEncoder().encode(content)), tool }, null, 2) + "\n");
    await mkdir(dirname(resolve(output)), { recursive: true }); await mkdir(output); createdOutput = true;
    for (const name of await readdir(pack)) await cp(join(pack, name), join(output, name), { recursive: true, errorOnExist: true, force: false });
    return bundle;
  } catch (error) { if (createdOutput) await rm(output, { recursive: true, force: true }); throw error; }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
