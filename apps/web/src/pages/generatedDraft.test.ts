import { expect, test } from "bun:test";
import { createApiClient } from "../api/client";
import { createDiceGameEditorDraft } from "../editor/state/bundle";
import { loadEditorDraft, serializeEditorDraft } from "../editor/state/persistence";
import { normalizeEditorDraft, exportBundleText } from "../editor/state/bundle";
import { compileDraftForPlaytest } from "../editor/playtest/runtime";
import type { AiGameDraftResponse } from "digipology-protocol/http";
import { generatedPublicationSlug, publishDraftAndHost, saveGeneratedDraft } from "./generatedDraft";
import { artworkDataUrl, artworkHash } from "../editor/state/artwork";
import { rasterPng } from "../../../../packages/protocol/src/raster.fixture";

function storage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}
function response(): AiGameDraftResponse {
  return { draft: compileDraftForPlaytest(createDiceGameEditorDraft("source", "2026-01-01T00:00:00Z")), validationReport: [{ check: "playability", ok: true }], qualityReport: [],
    telemetry: { attempts: 1, firstTryValid: true, retries: 0, fallback: false, violations: [] } };
}

test("only accepted output becomes an ordinary editable, saved browser draft", () => {
  const store = storage();
  const accepted = response();
  const draft = saveGeneratedDraft(store, accepted, "  A dice\n adventure  ", "created");
  expect(loadEditorDraft(store, "created")?.bundle).toEqual(accepted.draft);
  expect(draft.tagline).toBe("A dice adventure");
  expect(() => saveGeneratedDraft(store, { ...accepted, validationReport: [] }, "", "missing")).toThrow("playability");
  expect(() => saveGeneratedDraft(store, { ...accepted, qualityReport: [{ code: "broken", severity: "error", message: "Broken" }] }, "", "broken")).toThrow("playability");
  expect(() => saveGeneratedDraft({ ...store, setItem: () => { throw new Error("Quota"); } }, accepted, "", "quota")).toThrow("storage");
});

test("the authored tagline and bounded quality review survive the ordinary draft round trip", () => {
  const store = storage();
  const accepted = { ...response(), tagline: "  Roll to twenty,\n one turn at a time.  ", qualityReport: [{ code: "game_win_unobserved", message: "No winner in the sampled run", severity: "warning" as const }] };
  const draft = saveGeneratedDraft(store, accepted, "The original long prompt", "reviewed");
  expect(draft.tagline).toBe("Roll to twenty, one turn at a time.");
  expect(loadEditorDraft(store, draft.id)?.generationReview).toEqual({ manifestHash: accepted.draft.integrity.manifestHash, warnings: [{ code: "game_win_unobserved", message: "No winner in the sampled run" }] });
  expect(draft.bundle).not.toHaveProperty("generationReview");
  expect(draft.bundle).not.toHaveProperty("tagline");
});

test("complete generation sources survive editable backups while release exports keep their exact gameplay payload", () => {
  const store = storage(), accepted = response();
  const references = [{ name: "Rulebook.md", text: "\uFEFF# Complete rules\r\n" + "source text ".repeat(6_000) + "\nEND  \n", sourceUrl: "https://example.com/pinned/rules" }];
  const draft = saveGeneratedDraft(store, accepted, "Use these exact rules", "sourced-draft", references);
  expect(loadEditorDraft(store, draft.id)?.generationRequest).toEqual({ prompt: "Use these exact rules", references });
  const restored = normalizeEditorDraft(JSON.parse(serializeEditorDraft(draft)));
  expect(restored.generationRequest).toEqual(draft.generationRequest);
  expect(restored.bundle).toEqual(accepted.draft);
  expect(JSON.parse(exportBundleText(restored))).toEqual(accepted.draft);
  expect(restored.bundle).not.toHaveProperty("generationRequest");
  expect(() => normalizeEditorDraft({ ...draft, generationRequest: { prompt: "Rules", references: [{ name: "Broken.md", text: "\0" }] } })).toThrow("generation source");
});

test.each(["room failure", "lost publication reply"])("publication retry reuses the authored version after %s", async (failure) => {
  const draft = saveGeneratedDraft(storage(), response(), "A dice game", "my-version");
  let created = false, createCalls = 0, roomCalls = 0;
  const game = { slug: generatedPublicationSlug(draft), title: draft.title, latestReleaseId: "release_owned", visibility: "unlisted" };
  const client = createApiClient(async (path, init) => {
    if (path === "/api/games/mine") return Response.json({ games: created ? [game] : [] });
    if (path === "/api/games") {
      created = true; createCalls++;
      expect(JSON.parse(String(init?.body)).bundle).toEqual(draft.bundle);
      if (failure === "lost publication reply") throw new Error("connection lost after server committed");
      return Response.json({ game });
    }
    if (path === "/api/rooms") {
      roomCalls++;
      if (roomCalls === 1 && failure === "room failure") return Response.json({ error: { code: "unavailable", message: "Try again" } }, { status: 503 });
      return Response.json({ roomId: "room", joinCode: "ABCD-EFGH", inviteUrl: "https://production.example/join/ABCD-EFGH", playerId: "p1", roomToken: "local-fixture-token", wsUrl: "wss://preview.example/ws" });
    }
    throw new Error(`Unexpected route ${path}`);
  });
  expect((await publishDraftAndHost(client, draft, "https://preview.example")).ok).toBe(false);
  const retried = await publishDraftAndHost(client, draft, "https://preview.example");
  expect(retried).toMatchObject({ ok: true, value: { releaseId: "release_owned", inviteUrl: "https://preview.example/join/ABCD-EFGH" } });
  expect(createCalls).toBe(1);
});

test("a publication key is stable for retries and changes when the authored content changes", () => {
  const draft = saveGeneratedDraft(storage(), response(), "A dice game", "my-version");
  expect(generatedPublicationSlug(draft)).toBe(generatedPublicationSlug(structuredClone(draft)));
  expect(generatedPublicationSlug(draft)).not.toBe(generatedPublicationSlug({ ...draft, title: "New idea" }));
  expect(generatedPublicationSlug(draft)).toMatch(/^[a-z0-9-]{3,48}$/);
});

test("artwork upload retries a lost reply without opening a table early or duplicating publication", async () => {
  const draft = saveGeneratedDraft(storage(), response(), "A dice game", "cover-version");
  const bytes = rasterPng(4, 6);
  draft.artwork = { status: "ready", dataUrl: artworkDataUrl(bytes, "image/png"), info: { formatVersion: 1, contentType: "image/png", width: 4, height: 6, sha256: artworkHash(bytes), credits: { artist: "Créateur", license: "Original", sourceUrl: "https://example.com/art" } } };
  let created = false, uploads = 0, rooms = 0;
  const game = { slug: generatedPublicationSlug(draft), title: draft.title, latestReleaseId: "release", coverVersion: null as number | null };
  const client = createApiClient(async (path, init) => {
    if (path === "/api/games/mine") return Response.json({ games: created ? [game] : [] });
    if (path === "/api/games") { created = true; return Response.json({ game }); }
    if (String(path).includes("cover-info")) return Response.json({ coverVersion: 1, artwork: draft.artwork?.status === "ready" ? draft.artwork.info : null });
    if (String(path).endsWith("/cover")) {
      uploads++; game.coverVersion = 1;
      expect(new Headers(init?.headers).get("Content-Type")).toBe("image/png");
      expect(JSON.parse(decodeURIComponent(new Headers(init?.headers).get("X-Digipology-Cover-Credits")!)).artist).toBe("Créateur");
      throw new Error("reply lost after committed artwork");
    }
    if (path === "/api/rooms") { rooms++; return Response.json({ roomId: "room", joinCode: "ABCD-EFGH" }); }
    throw new Error(`Unexpected ${path}`);
  });
  const verify = async () => undefined; // Codec decoding is exercised by the browser suite.
  expect(await publishDraftAndHost(client, draft, "https://example.com", verify)).toMatchObject({ ok: false, stage: "artwork", error: { message: expect.stringContaining("artwork could not be saved") } });
  expect(rooms).toBe(0);
  expect((await publishDraftAndHost(client, draft, "https://example.com", verify)).ok).toBe(true);
  expect(uploads).toBe(1); expect(rooms).toBe(1);
  draft.artwork = { status: "unavailable" };
  expect(await publishDraftAndHost(client, draft, "https://example.com", verify)).toMatchObject({ ok: false, error: { code: "invalid_artwork" } });
  expect(rooms).toBe(1);
});
