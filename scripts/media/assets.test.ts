import { expect, test } from "bun:test";
import { fetchAsset, inspectGlb, searchAudio, searchModels, type AssetCandidate } from "./assets";

test("online model discovery retains provenance and filters by all search terms", async () => {
  const results = await searchModels("wood table", async (url, init) => {
    expect(url).toBe("https://api.polyhaven.com/assets?t=models");
    expect(new Headers(init?.headers).get("User-Agent")).toContain("Digipology");
    return Response.json({ wood_table: { name: "Wooden Table", categories: ["furniture"], tags: ["wood"], authors: { Artist: "https://example.org" } }, stone: { name: "Stone", tags: ["rock"] } });
  });
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ license: "CC0-1.0", creator: "Artist", sourceUrl: "https://polyhaven.com/a/wood_table" });
  expect(results[0]!.attribution).toContain("Powered by Poly Haven");
});
test("audio discovery rejects unusable URLs and incompatible license records", async () => {
  const track = { id: "one", title: "Wood dice", creator: "Artist", foreign_landing_url: "https://example.org/sound/one", url: "https://cdn.freesound.org/one.ogg", license: "cc0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/" };
  const results = await searchAudio("dice", async () => Response.json({ results: [track, { ...track, license: "by-nc" }, { ...track, url: "file:///etc/passwd" }] }));
  expect(results).toHaveLength(1);
  expect(results[0]?.attribution).toContain("Wood dice — Artist");
});
test("provider errors remain errors instead of a fake empty search", async () => {
  await expect(searchAudio("dice", async () => new Response(null, { status: 503 }))).rejects.toThrow("503");
});
test("an asset redirect cannot turn a supported provider into a request to a local service", async () => {
  const candidate: AssetCandidate = { id: "redirect", kind: "audio", title: "Sound", provider: "openverse", sourceUrl: "https://freesound.org/s/1/", downloadUrl: "https://cdn.freesound.org/audio.ogg", creator: "Artist", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", attribution: "Sound — Artist, CC0" };
  let requests = 0;
  await expect(fetchAsset(candidate, `/tmp/digipology-redirect-${crypto.randomUUID()}.ogg`, async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
  })).rejects.toThrow("explicit provider support");
  expect(requests).toBe(1);
});
test("model admission rejects truncated GLB and external resources", () => {
  expect(() => inspectGlb(new Uint8Array([1, 2, 3]))).toThrow("GLB");
  const json = new TextEncoder().encode(JSON.stringify({ buffers: [{ uri: "https://remote.example/model.bin" }], meshes: [{ primitives: [] }], accessors: [] }).padEnd(256));
  const bytes = new Uint8Array(20 + json.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20);
  expect(() => inspectGlb(bytes)).toThrow("embed all");
});
