import { expect, test } from "bun:test";
import { inspectSoundWave, parseSoundBundle, soundBytes, soundHash } from "./sound-bundle";

const original = await Bun.file(new URL("../../../apps/web/public/audio/table-effects/v1/bundle.json", import.meta.url)).text();
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest();
const parse = (text: string) => parseSoundBundle(text, sha256);

test("actual mastered source clips have exact hashes, measurable signal, complete containers and quiet edges", () => {
  const bundle = parse(original); expect(bundle.clips).toHaveLength(3);
  for (const clip of bundle.clips) {
    const bytes = soundBytes(clip.dataUrl), stats = inspectSoundWave(bytes);
    expect(soundHash(bytes, sha256)).toBe(clip.sha256); expect(stats.rmsDb).toBeGreaterThan(-55);
    expect(stats.peakDb).toBeLessThanOrEqual(-1.4); expect(stats.edgePeak).toBeLessThan(.025);
    expect(stats.duration).toBe(clip.processing.duration); expect(clip.source.creator).toBe("Kenney");
  }
});
test("tampering, truncation, silent PCM, clipping and abrupt edges cannot be admitted by updating metadata", () => {
  const bytes = soundBytes(parse(original).clips[0]!.dataUrl);
  expect(() => inspectSoundWave(bytes.subarray(0, bytes.length - 2))).toThrow("complete");
  const silence = bytes.slice();
  const at = Buffer.from(silence).indexOf("data"); silence.fill(0, at + 8);
  expect(() => inspectSoundWave(silence)).toThrow("audible");
  for (const offset of [at + 8, at + 8 + 1000]) { const clipped = bytes.slice(); new DataView(clipped.buffer).setInt16(offset, 32767, true); expect(() => inspectSoundWave(clipped)).toThrow(); }
  const bundle = parse(original), altered = bytes.slice(); altered[at + 8 + 1000] = altered[at + 8 + 1000]! ^ 1;
  bundle.clips[0]!.dataUrl = `data:audio/wav;base64,${Buffer.from(altered).toString("base64")}`;
  expect(() => parse(JSON.stringify(bundle))).toThrow("SHA-256");
});
test("uncredited, unsafe, duplicate, over-budget or inconsistent bundles preserve admission boundaries", () => {
  for (const mutate of [
    (b: ReturnType<typeof parse>) => { b.clips[0]!.source.creator = "Unknown creator"; },
    (b: ReturnType<typeof parse>) => { b.clips[0]!.source.url = "javascript:alert(1)"; },
    (b: ReturnType<typeof parse>) => { b.clips[0]!.processing.oversampledPeakDb = 0; },
    (b: ReturnType<typeof parse>) => { b.clips[0]!.processing.duration = 2; },
    (b: ReturnType<typeof parse>) => { b.clips.push(b.clips[0]!); },
    (b: ReturnType<typeof parse>) => { b.version = .5; },
  ]) { const bundle = parse(original); mutate(bundle); expect(() => parse(JSON.stringify(bundle))).toThrow(); }
  expect(() => parse(" ".repeat(384 * 1024 + 1))).toThrow("384 KiB");
});
