import { writeFile, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface AssetCandidate {
  id: string;
  kind: "model" | "audio";
  title: string;
  provider: "polyhaven" | "openverse";
  sourceUrl: string;
  creator: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  downloadUrl?: string;
  filesUrl?: string;
  durationMs?: number;
}

type AssetFetch = (url: string, init?: RequestInit) => Promise<Response>;
const USER_AGENT = "Digipology asset harness/1.0 (+https://digipology.com)";
const LICENSES = new Set(["cc0", "by", "by-sa"]);
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function https(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
async function json(url: string, fetcher: AssetFetch): Promise<unknown> {
  const response = await fetcher(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Asset provider ${new URL(url).hostname} returned ${response.status}`);
  if (Number(response.headers.get("Content-Length") ?? 0) > 8 * 1024 * 1024) throw new Error("Asset provider response is too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Asset provider returned no data");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Asset provider response is too large"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function searchModels(query: string, fetcher: AssetFetch = fetch): Promise<AssetCandidate[]> {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length || query.length > 200) throw new Error("Supply a model search query of 1–200 characters");
  const data = record(await json("https://api.polyhaven.com/assets?t=models", fetcher));
  return Object.entries(data).filter(([id, value]) => {
    if (!/^[a-z0-9_]+$/.test(id)) return false;
    const item = record(value);
    const text = [item.name, ...(Array.isArray(item.tags) ? item.tags : []), ...(Array.isArray(item.categories) ? item.categories : [])].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  }).slice(0, 20).map(([id, value]) => {
    const item = record(value);
    const title = typeof item.name === "string" ? item.name : id;
    const creator = Object.keys(record(item.authors)).join(", ") || "Poly Haven contributors";
    return {
      id, kind: "model", title, provider: "polyhaven", sourceUrl: `https://polyhaven.com/a/${id}`,
      creator, license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution: `${title} — ${creator}. CC0. Powered by Poly Haven.`,
      filesUrl: `https://api.polyhaven.com/files/${id}`,
    };
  });
}

export async function modelFiles(id: string, fetcher: AssetFetch = fetch): Promise<Array<{ format: string; url: string; bytes: number | null }>> {
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error("Invalid Poly Haven asset ID");
  const files: Array<{ format: string; url: string; bytes: number | null }> = [];
  const walk = (value: unknown, path: string[]) => {
    const item = record(value);
    const url = https(item.url);
    if (url && new URL(url).hostname === "dl.polyhaven.org" && /\.(glb|gltf|blend|fbx)(?:\?|$)/i.test(url)) {
      files.push({ format: path.join("/"), url, bytes: typeof item.size === "number" ? item.size : null });
    }
    for (const [key, child] of Object.entries(item)) if (typeof child === "object" && child !== null) walk(child, [...path, key]);
  };
  walk(await json(`https://api.polyhaven.com/files/${id}`, fetcher), []);
  return files;
}

export async function searchAudio(query: string, fetcher: AssetFetch = fetch): Promise<AssetCandidate[]> {
  if (!query.trim() || query.length > 200) throw new Error("Supply an audio search query of 1–200 characters");
  const url = new URL("https://api.openverse.org/v1/audio/");
  url.search = new URLSearchParams({ q: query, license: "cc0,by,by-sa", page_size: "20" }).toString();
  const data = record(await json(url.href, fetcher));
  return (Array.isArray(data.results) ? data.results : []).flatMap((value) => {
    const item = record(value);
    const sourceUrl = https(item.foreign_landing_url);
    const downloadUrl = https(item.url);
    const licenseUrl = https(item.license_url);
    if (!sourceUrl || !downloadUrl || !licenseUrl || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.license !== "string" || !LICENSES.has(item.license)) return [];
    const creator = typeof item.creator === "string" ? item.creator : "Unknown creator";
    const license = `${item.license.toUpperCase()} ${typeof item.license_version === "string" ? item.license_version : ""}`.trim();
    return [{ id: item.id, kind: "audio" as const, title: item.title, provider: "openverse" as const, sourceUrl, downloadUrl, creator, license, licenseUrl,
      attribution: `${item.title} — ${creator}. ${license}. ${sourceUrl}`,
      ...(typeof item.duration === "number" && Number.isFinite(item.duration) ? { durationMs: item.duration } : {}),
    }];
  });
}

/** Check GLB admission budgets; renderer import still validates complete glTF structure. */
export function inspectGlb(bytes: Uint8Array): { triangles: number; meshes: number; bytes: number } {
  if (bytes.length < 20 || bytes.length > 16 * 1024 * 1024) throw new Error("Model must be a GLB of at most 16 MiB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) throw new Error("Invalid GLB 2 header");
  const length = view.getUint32(12, true);
  if (length > bytes.length - 20) throw new Error("Truncated model JSON");
  const model = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  if (!Array.isArray(model.meshes) || model.meshes.length === 0 || !Array.isArray(model.accessors)) throw new Error("Model contains no usable geometry");
  for (const resource of [...(model.buffers ?? []), ...(model.images ?? [])]) {
    if (resource.uri !== undefined) throw new Error("Models must embed all buffers and images; external and data URI resources require processing first");
  }
  let triangles = 0;
  for (const mesh of model.meshes) for (const primitive of mesh.primitives ?? []) {
    if ((primitive.mode ?? 4) !== 4) throw new Error("Only triangle geometry is supported");
    const accessor = model.accessors[primitive.indices ?? primitive.attributes?.POSITION];
    if (!Number.isSafeInteger(accessor?.count) || accessor.count < 3 || accessor.count % 3 !== 0) throw new Error("Invalid triangle accessor");
    triangles += accessor.count / 3;
  }
  if (triangles === 0 || triangles > 100_000) throw new Error("Model exceeds the 100,000 triangle budget or is empty");
  return { triangles, meshes: model.meshes.length, bytes: bytes.length };
}

export async function fetchAsset(candidate: AssetCandidate, output: string, fetcher: AssetFetch = fetch) {
  const hosts = new Set(["dl.polyhaven.org", "freesound.org", "cdn.freesound.org", "upload.wikimedia.org"]);
  let location = https(candidate.downloadUrl);
  if (!location || !["model", "audio"].includes(candidate.kind) || !["polyhaven", "openverse"].includes(candidate.provider) || !candidate.attribution || !https(candidate.sourceUrl) || !https(candidate.licenseUrl)) throw new Error("An asset needs complete source, license, attribution and download metadata");
  if (await Bun.file(output).exists() || await Bun.file(`${output}.json`).exists()) throw new Error("Refusing to overwrite an existing asset or provenance report");
  let response: Response | null = null;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    if (!hosts.has(new URL(location).hostname)) throw new Error(`Asset download host needs explicit provider support: ${new URL(location).hostname}`);
    response = await fetcher(location, { redirect: "manual", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (response.status < 300 || response.status >= 400) break;
    const next = response.headers.get("Location");
    location = next ? https(new URL(next, location).href) : null;
    if (!location) throw new Error("Invalid asset redirect");
  }
  if (!response?.ok || !response.body) throw new Error(`Asset download failed (${response?.status ?? "no response"})`);
  const limit = candidate.kind === "model" ? 16 * 1024 * 1024 : 32 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length") ?? 0) > limit) throw new Error("Asset exceeds its download budget");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > limit) { await reader.cancel(); throw new Error("Asset exceeds its download budget"); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const geometry = candidate.kind === "model" ? inspectGlb(bytes) : null;
  await mkdir(dirname(resolve(output)), { recursive: true });
  let created = false;
  try {
    await writeFile(output, bytes, { flag: "wx" }); created = true;
    const audio = candidate.kind === "audio" ? await (await import("./audio")).probeAudio(output) : null;
    const report = { ...candidate, bytes: size, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), geometry, audio };
    await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    return report;
  } catch (error) { if (created) await unlink(output); throw error; }
}
