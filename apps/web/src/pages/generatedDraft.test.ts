import { expect, test } from "bun:test";
import { createApiClient } from "../api/client";
import { createDiceGameEditorDraft } from "../editor/state/bundle";
import { loadEditorDraft } from "../editor/state/persistence";
import { compileDraftForPlaytest } from "../editor/playtest/runtime";
import type { AiGameDraftResponse } from "digipology-protocol/http";
import { generatedPublicationSlug, publishDraftAndHost, saveGeneratedDraft } from "./generatedDraft";

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
