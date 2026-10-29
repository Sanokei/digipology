import { writeFile, copyFile } from "node:fs/promises";
import { fetchAsset, inspectGlb, modelFiles, searchAudio, searchModels, type AssetCandidate } from "./media/assets";
import { masterAudio } from "./media/audio";
import { buildTableSounds } from "./media/table-sounds";

const [action, ...args] = Bun.argv.slice(2);
if (action === "build-table-sounds" && args[0] && args[1]) {
  const bundle = await buildTableSounds(args[0], args[1], args[2]);
  console.log(JSON.stringify({ id: bundle.id, version: bundle.version, clips: bundle.clips.map((clip) => ({ cue: clip.cue, sha256: clip.sha256, processing: clip.processing })) }, null, 2));
} else if (action === "search-models" || action === "search-audio") {
  const query = args.join(" ");
  const candidates = action === "search-models" ? await searchModels(query) : await searchAudio(query);
  console.log(JSON.stringify({ query, providerCredit: action === "search-models" ? "Powered by Poly Haven" : "Openverse; verify attribution before publication", candidates }, null, 2));
} else if (action === "model-files" && args[0]) {
  console.log(JSON.stringify(await modelFiles(args[0]), null, 2));
} else if (action === "fetch-asset" && args[0] && args[1] && args[2]) {
  const search = await Bun.file(args[0]).json() as { candidates?: AssetCandidate[] };
  const candidate = search.candidates?.find((item) => item.id === args[1]);
  if (!candidate) throw new Error("Asset ID is not present in the supplied search results");
  console.log(JSON.stringify(await fetchAsset(candidate, args[2]), null, 2));
} else if (action === "inspect-glb" && args[0]) {
  console.log(JSON.stringify(inspectGlb(new Uint8Array(await Bun.file(args[0]).arrayBuffer())), null, 2));
} else if (action === "import-glb" && args[0] && args[1]) {
  const bytes = new Uint8Array(await Bun.file(args[0]).arrayBuffer());
  const report = inspectGlb(bytes);
  await copyFile(args[0], args[1], 1);
  await writeFile(`${args[1]}.json`, JSON.stringify({ ...report, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
} else if (action === "master-audio" && args[0] && args[1] && ["effect", "music"].includes(args[2] ?? "")) {
  console.log(JSON.stringify(await masterAudio(args[0], args[1], args[2] as "effect" | "music", args.includes("--loop")), null, 2));
} else {
  throw new Error("Usage: bun scripts/media.ts build-table-sounds MANIFEST OUTPUT_DIR [VERIFIED_GIT_CACHE] | search-models QUERY | search-audio QUERY | model-files ID | fetch-asset SEARCH_JSON ASSET_ID OUTPUT | inspect-glb FILE | import-glb INPUT OUTPUT | master-audio INPUT OUTPUT effect|music [--loop]");
}
