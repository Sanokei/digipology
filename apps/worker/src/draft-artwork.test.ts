import { afterEach, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { handleDraftArtwork, handleArtDirection, handleArtworkOriginal, handleArtworkReview, artworkPrompt, type ImageFetch } from "./draft-artwork";
import { handlePlatformRequest } from "./platform";
import { D1Repositories } from "./d1-repositories";
import { builtinCatalog } from "./catalog";
import { coverByteHash } from "./cover-storage";
import { normalizeArtworkGeneration, normalizeRasterArtworkInfo, type ArtworkGeneration, type DraftArtRequest, type GeneratedArtwork } from "digipology-protocol";
import type { AuthenticatedSession } from "./auth";

const NOW = Date.UTC(2026, 9, 29, 18);
const direction = { version: 1 as const, style: "Ink-blue and copper alchemical engraving for this game's merchant economy.", coverPrompt: "One merchant mage balancing a glowing coin and an animated stone hand.", cardBackPrompt: "A large symmetric copper seal joining an alembic and stone hands; 180-degree rotation." };
const input: DraftArtRequest = { draftId: "creator-owned-draft", title: "Copper Ledger", purpose: "card-back", direction, revision: 0 };
const databases: Database[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const request = (body: unknown) => new Request("https://game.example/api/ai/artwork", { method: "POST", headers: { "Content-Type": "application/json", "X-Digipology-CSRF": "1" }, body: JSON.stringify(body) });
const source = () => Bun.file(new URL("../../web/public/art/first-deal.webp", import.meta.url)).arrayBuffer();
function sqliteD1(database: Database): D1Database {
  const make = (sql: string, values: SQLQueryBindings[] = []) => {
    const execute = () => {
      const rows = /\bRETURNING\b/i.test(sql) ? database.query(sql).all(...values) : [];
      const changes = /\bRETURNING\b/i.test(sql) ? rows.length : database.query(sql).run(...values).changes;
      return { success: true, results: rows, meta: { duration: 0, size_after: 0, rows_read: rows.length, rows_written: changes, last_row_id: 0, changed_db: !!changes, changes } };
    };
    return { sql, values, execute, bind: (...next: SQLQueryBindings[]) => make(sql, next),
      first: async () => database.query(sql).get(...values) ?? null,
      all: async () => ({ success: true, results: database.query(sql).all(...values), meta: {} }), run: async () => execute() };
  };
  return { prepare: make, batch: async (statements: Array<ReturnType<typeof make>>) => database.transaction(() => statements.map((statement) => statement.execute()))() } as unknown as D1Database;
}
async function fixture() {
  const database = new Database(":memory:"); databases.push(database);
  const folder = new URL("../migrations/", import.meta.url).pathname;
  for (const name of (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort()) database.exec(await Bun.file(join(folder, name)).text());
  const db = sqliteD1(database), objects = new Map<string, string>();
  const controls = { failPut: false };
  const bucket = { get: async (key: string) => {
    const value = objects.get(key); return value === undefined ? null : { size: new TextEncoder().encode(value).length, json: async () => JSON.parse(value) };
  }, put: async (key: string, value: string) => { if (controls.failPut) throw new Error("controlled original-storage outage"); objects.set(key, value); } } as unknown as R2Bucket;
  const session: AuthenticatedSession = { user: { id: "art-owner", name: "Creator", email: "creator@example.test" }, token: "test-only-session", expiresAt: NOW + 86_400_000 };
  const env = { DB: db, RELEASES: bucket, AI_IMAGE_MODEL: "explicit-image-fixture", AI_IMAGE_BASE_URL: "http://127.0.0.1:9899/v1", AI_MODEL: "text-fixture", AI_DAILY_REQUEST_CAP: "50" } as unknown as Env;
  return { database, objects, controls, context: { env, repositories: new D1Repositories(db), session, now: NOW } };
}
async function imageResponse(bytes?: Uint8Array) {
  const data = bytes ?? new Uint8Array(await source());
  return Response.json({ data: [{ b64_json: Buffer.from(data).toString("base64") }] });
}

test("real raster bytes retain hashes/originals and completed replies reuse the same game/revision", async () => {
  const f = await fixture(); let calls = 0; const payloads: object[] = [];
  const imageFetch: ImageFetch = async (url, init) => { calls++; expect(url).toBe("http://127.0.0.1:9899/v1/images/generations"); payloads.push(JSON.parse(String(init.body))); return imageResponse(); };
  const context = { ...f.context, dependencies: { imageFetch } };
  const first = await handleDraftArtwork(request(input), context); expect(first.status).toBe(200);
  const result = await first.json() as GeneratedArtwork;
  expect(result.model).toBe("explicit-image-fixture"); expect(result.originalSha256).toBe(coverByteHash(new Uint8Array(await source())));
  expect(payloads[0]).toMatchObject({ model: "explicit-image-fixture", output_format: "webp", output_compression: 80, n: 1 });
  expect(String((payloads[0] as { prompt: string }).prompt)).toContain(direction.cardBackPrompt);
  const repeated = await handleDraftArtwork(request(input), context); expect(await repeated.json() as GeneratedArtwork).toEqual(result); expect(calls).toBe(1);
  const original = await handleArtworkOriginal(result.assetId, false, context);
  expect(original.status).toBe(200); expect(coverByteHash(new Uint8Array(await original.arrayBuffer()))).toBe(result.originalSha256);
  const receipt = await (await handleArtworkOriginal(result.assetId, true, context)).json() as { renderPrompt: string; dataUrl?: string };
  expect(receipt.renderPrompt).toBe(artworkPrompt(input)); expect(receipt.dataUrl).toBeUndefined();
  const other = await handleArtworkOriginal(result.assetId, false, { ...context, session: { ...context.session, user: { ...context.session.user, id: "another-owner" } } });
  expect(other.status).toBe(404);
  const later = await (await handleDraftArtwork(request({ ...input, revision: 1 }), context)).json() as GeneratedArtwork;
  const separateGame = await (await handleDraftArtwork(request({ ...input, draftId: "second-created-game" }), context)).json() as GeneratedArtwork;
  expect(later.assetId).not.toBe(result.assetId); expect(separateGame.assetId).not.toBe(result.assetId); expect(calls).toBe(3);
  expect((await (await handleArtworkOriginal(result.assetId, false, context)).arrayBuffer()).byteLength).toBe(result.byteLength);
});

test("concurrent identical local requests share one provider operation and neither consumes a response body twice", async () => {
  const f = await fixture(); let calls = 0;
  const context = { ...f.context, dependencies: { imageFetch: async () => { calls++; await Promise.resolve(); return imageResponse(); } } };
  const results = await Promise.all([handleDraftArtwork(request(input), context), handleDraftArtwork(request(input), context)]);
  expect(calls).toBe(1); expect(await results[0]!.json()).toEqual(await results[1]!.json());
});

test("missing account-selected image model, invalid bytes and storage failures never invent ready artwork", async () => {
  const f = await fixture(); let calls = 0;
  const disabled = await handleDraftArtwork(request(input), { ...f.context, env: { ...f.context.env, AI_IMAGE_MODEL: "" } as Env, dependencies: { imageFetch: async () => { calls++; return imageResponse(); } } });
  expect(disabled.status).toBe(503); expect(await disabled.json()).toMatchObject({ error: { code: "artwork_unconfigured" } }); expect(calls).toBe(0);
  const noRaster = await handleDraftArtwork(request(input), { ...f.context, dependencies: { imageFetch: async () => Response.json({ data: [{ b64_json: Buffer.from("<svg>not raster</svg>").toString("base64") }] }) } });
  expect(noRaster.status).toBe(502); expect(await noRaster.json()).toMatchObject({ error: { code: "artwork_provider_invalid" } }); expect(f.objects.size).toBe(0);
  const unreadable = await handleDraftArtwork(request(input), { ...f.context, dependencies: { imageFetch: async () => new Response("provider error page", { status: 200 }) } });
  expect(unreadable.status).toBe(502); expect(await unreadable.json()).toMatchObject({ error: { code: "artwork_provider_invalid" } });
  f.controls.failPut = true;
  const failed = await handleDraftArtwork(request(input), { ...f.context, dependencies: { imageFetch: async () => imageResponse() } });
  expect(failed.status).toBe(503); expect(await failed.json()).toMatchObject({ error: { code: "artwork_storage_unavailable" } }); expect(f.objects.size).toBe(0);
});

test("cached corruption remains explicit and a new revision preserves prior originals", async () => {
  const f = await fixture(), context = { ...f.context, dependencies: { imageFetch: async () => imageResponse() } };
  const first = await (await handleDraftArtwork(request(input), context)).json() as GeneratedArtwork;
  const key = [...f.objects.keys()][0]!, object = JSON.parse(f.objects.get(key)!);
  object.artwork.originalSha256 = "sha256:" + "0".repeat(64); f.objects.set(key, JSON.stringify(object));
  const failed = await handleDraftArtwork(request(input), context); expect(failed.status).toBe(503); expect(await failed.json()).toMatchObject({ error: { code: "artwork_cache_invalid" } });
  const next = await (await handleDraftArtwork(request({ ...input, revision: 1 }), context)).json() as GeneratedArtwork;
  expect(next.assetId).not.toBe(first.assetId); expect(f.objects.size).toBe(2);
});

test("authentication, strict input and daily budget are enforced before image inference", async () => {
  const f = await fixture(); let calls = 0;
  const anonymous = await handlePlatformRequest(request(input), f.context.env, { imageFetch: async () => { calls++; return imageResponse(); }, now: NOW });
  expect(anonymous.status).toBe(401);
  expect((await handleDraftArtwork(request({ ...input, remoteUrl: "https://example.com/picture" }), f.context)).status).toBe(400);
  f.database.query("INSERT INTO ai_usage(user_id,day,requests) VALUES(?,?,?)").run("art-owner", "2026-10-29", 50);
  const limited = await handleDraftArtwork(request(input), { ...f.context, dependencies: { imageFetch: async () => { calls++; return imageResponse(); } } });
  expect(limited.status).toBe(429); expect(calls).toBe(0);
});

test("game-authored direction is separate from images and review binds only successful actual checks", async () => {
  const f = await fixture();
  const planned = await handleArtDirection(request({ title: input.title, rulebook: "Trade magical commodities; collect crowns or bankrupt rivals." }), {
    ...f.context, dependencies: { modelFetch: async () => ({ choices: [{ message: { content: JSON.stringify(direction) } }] }) },
  });
  expect(planned.status).toBe(200); expect(await planned.json() as typeof direction).toEqual(direction); expect(f.objects.size).toBe(0);
  const bundle = builtinCatalog.getRelease("builtin_dice_dash_3")!.bundle;
  let checks = 0;
  const reviewed = await handleArtworkReview(request({ bundle }), { ...f.context, dependencies: { qualityCheck: async () => { checks++; return []; } } });
  expect(reviewed.status).toBe(200); expect(await reviewed.json()).toMatchObject({ manifestHash: bundle.integrity.manifestHash, validationReport: expect.arrayContaining([{ check: "playability", ok: true }]), qualityReport: [] }); expect(checks).toBe(1);
  const broken = structuredClone(bundle); broken.integrity.manifestHash = "sha256:" + "0".repeat(64);
  expect((await handleArtworkReview(request({ bundle: broken }), { ...f.context, dependencies: { qualityCheck: async () => { checks++; return []; } } })).status).toBe(422); expect(checks).toBe(1);
  const errors = await handleArtworkReview(request({ bundle }), { ...f.context, dependencies: { qualityCheck: async () => [{ code: "lua_runtime_error", message: "Real check found invalid gameplay", severity: "error" }] } });
  expect(await errors.json()).toMatchObject({ validationReport: expect.arrayContaining([{ check: "playability", ok: false }]) });
});

test("artwork provenance is validated instead of silently disappearing in backups or image information", () => {
  const provenance = { model: "selected-model", promptHash: "sha256:" + "1".repeat(64), originalSha256: "sha256:" + "2".repeat(64), generatedAt: "2026-10-29T18:00:00.000Z" };
  const info = { formatVersion: 1, contentType: "image/webp", width: 768, height: 1152, sha256: "sha256:" + "3".repeat(64), credits: { artist: "Creator", license: "Original", sourceUrl: "" }, generation: provenance };
  expect(normalizeRasterArtworkInfo(info)?.generation).toEqual(provenance);
  expect(normalizeRasterArtworkInfo({ ...info, generation: { ...provenance, originalSha256: "forged" } })).toBeNull();
  const generation: ArtworkGeneration = { version: 1, sourceManifestHash: info.sha256, direction, jobs: { cover: { status: "failed", revision: 1, assetId: "art_" + "a".repeat(64), selectedAssetId: "art_" + "b".repeat(64), outputSha256: info.sha256 }, cardBack: { status: "pending", revision: 1 } } };
  expect(normalizeArtworkGeneration(generation)).toEqual(generation);
  expect(normalizeArtworkGeneration({ ...generation, jobs: { ...generation.jobs, cover: { status: "ready", revision: -1 } } })).toBeNull();
  expect(normalizeArtworkGeneration({ ...generation, jobs: { ...generation.jobs, cover: { ...generation.jobs.cover, selectedAssetId: "foreign/path" } } })).toBeNull();
});

test("scoped card artwork binds cache and retained originals to actual family, purpose and brief, requesting real landscape dimensions", async () => {
  const f = await fixture(); let calls = 0;
  const { rasterPng } = await import("../../../packages/protocol/src/raster.fixture");
  const context = { ...f.context, dependencies: { imageFetch: async (_url: string, init: RequestInit) => {
    calls++; const body = JSON.parse(String(init.body));
    expect(body.size).toBe("1536x1024"); expect(body.prompt).toContain("Subject: family Potions (potions)");
    expect(body.prompt).toContain("no private front clues");
    return Response.json({ data: [{ b64_json: Buffer.from(rasterPng(1536, 1024)).toString("base64") }] });
  } } };
  const scoped: DraftArtRequest = { ...input, purpose: "card-illustration", subject: { kind: "family", id: "potions", name: "Potions", brief: "An alembic, no private front clues" } };
  const first = await handleDraftArtwork(request(scoped), context); expect(first.status).toBe(200);
  const asset = await first.json() as GeneratedArtwork; expect(asset.width).toBe(1536); expect(asset.height).toBe(1024);
  expect(await (await handleDraftArtwork(request(scoped), context)).json() as GeneratedArtwork).toEqual(asset); expect(calls).toBe(1);
  const original = await handleArtworkOriginal(asset.assetId, false, context); expect(original.status).toBe(200); expect(coverByteHash(new Uint8Array(await original.arrayBuffer()))).toBe(asset.originalSha256);
  expect((await handleArtworkOriginal(asset.assetId, false, { ...context, session: { ...context.session, user: { ...context.session.user, id: "other-owner" } } })).status).toBe(404);
  expect((await handleDraftArtwork(request({ ...scoped, purpose: "cover" }), context)).status).toBe(400);
  expect((await handleDraftArtwork(request({ ...scoped, subject: undefined }), context)).status).toBe(400);
  const changed = await (await handleDraftArtwork(request({ ...scoped, subject: { ...scoped.subject!, brief: "Changed no private front clues" } }), context)).json() as GeneratedArtwork;
  expect(changed.assetId).not.toBe(asset.assetId); expect(calls).toBe(2);
});
