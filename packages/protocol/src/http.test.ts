import { describe, expect, test } from "bun:test";
import {
  ACTION_RETENTION,
  CHECKPOINT_ATTESTATION_INTERVAL,
  effectiveLuaStdlibVersion,
  rawContentHash,
  releaseManifestHash,
  validateCreateAiGameRequest,
  validateCreateGameRequest,
  validateCreateReleaseRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  validateEditAiGameRequest,
  validateGameSummaryDto,
  validateQuickPlayRequest,
  validateRequestMagicLinkRequest,
  validateResumeSaveRequest,
  validateSaveTableRequest,
  validateSavedTableDto,
  validateReleaseBundle,
  validateUpdateGameRequest,
  validateUpdateMeRequest,
  type GameSnapshotDto,
  type ReleaseBundleDto,
} from "./http";

test("keeps checkpoint cadence below the shared action retention window", () => {
  expect(ACTION_RETENTION).toBe(500);
  expect(CHECKPOINT_ATTESTATION_INTERVAL).toBe(200);
  expect(CHECKPOINT_ATTESTATION_INTERVAL).toBeLessThan(ACTION_RETENTION);
});

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function fakeSha(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    result[index % 32] = ((result[index % 32] ?? 0) + (bytes[index] ?? 0) + index) % 256;
  }
  return result;
}

function fakeHash(value: unknown): string {
  return rawContentHash(stable(value), fakeSha);
}

const VALIDATION = {
  canonicalStringify: stable,
  hashValue: fakeHash,
  sha256: fakeSha,
  snapshotStateHash: fakeHash,
  loadSnapshot(value: GameSnapshotDto) {
    const state = value.state as Record<string, unknown>;
    if (state.releaseId !== value.releaseId || fakeHash(state) !== value.stateHash) throw new Error("bad snapshot");
    return state;
  },
};

function validBundle(): ReleaseBundleDto {
  const content = "{}";
  const state = {
    releaseId: "draft_release_1",
    sequence: 0,
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    settings: {}, players: {}, seats: {}, entities: {}, scriptState: {}, prompts: {},
  };
  const bundle: ReleaseBundleDto = {
    formatVersion: 1,
    gameId: "draft_game",
    releaseId: "draft_release_1",
    releaseNumber: 1,
    kernelVersion: 1,
    luaApiVersion: 1,
    networkProtocolVersion: 1,
    interactionMode: "sandbox",
    minPlayers: 1,
    maxPlayers: 4,
    files: [{ path: "runtime/game.json", contentHash: rawContentHash(content, fakeSha), byteLength: 2, content }],
    integrity: { manifestHash: "sha256:" + "0".repeat(64) },
    initialSnapshot: {
      formatVersion: 1, kernelVersion: 1, releaseId: state.releaseId, sequence: 0,
      state, stateHash: fakeHash(state),
    },
  };
  bundle.integrity.manifestHash = releaseManifestHash(bundle, fakeHash);
  return bundle;
}

describe("HTTP v1 request validators", () => {
  test("accepts ten-player releases and rejects eleven", () => {
    const ten = validBundle();
    ten.maxPlayers = 10;
    ten.integrity.manifestHash = releaseManifestHash(ten, fakeHash);
    expect(validateReleaseBundle(ten, VALIDATION).find((item) => item.check === "player_limits")?.ok).toBe(true);
    const eleven = { ...ten, maxPlayers: 11 };
    expect(validateReleaseBundle(eleven, VALIDATION).find((item) => item.check === "player_limits")?.ok).toBe(false);
  });
  test("validates saved-table DTOs and requests", () => {
    const snapshot = validBundle().initialSnapshot;
    expect(validateSaveTableRequest({ roomToken: "token", snapshot, label: "Friday" }).ok).toBe(true);
    // HTTP authorization maps missing/empty tokens to 403 before DTO validation.
    expect(validateSaveTableRequest({ roomToken: "", snapshot }).ok).toBe(false);
    expect(validateSaveTableRequest({ snapshot }).ok).toBe(false);
    expect(validateSaveTableRequest({ roomToken: "token", snapshot: { ...snapshot, stateHash: "bad" } }).ok).toBe(false);
    expect(validateResumeSaveRequest({ visibility: "private", displayName: "Host" }).ok).toBe(true);
    expect(validateResumeSaveRequest({ visibility: "friends" }).ok).toBe(false);
    const savedTable = {
      saveId: "save_1", gameSlug: "first-deal", gameTitle: "First Deal",
      releaseId: "builtin_first_deal_1", sequence: 7,
      createdAt: "2026-08-16T12:00:00.000Z", byteLength: 123,
    };
    expect(validateSavedTableDto(savedTable).ok).toBe(true);
    expect(validateSavedTableDto({
      ...savedTable, resumable: false, resumeBlockedReason: "scripted_resume_unsupported",
    }).ok).toBe(true);
    expect(validateSavedTableDto({ ...savedTable, resumable: "no" }).ok).toBe(false);
  });
  test("validates magic-link request bodies", () => {
    expect(validateRequestMagicLinkRequest({ email: "player@example.com" })).toEqual({
      ok: true,
      value: { email: "player@example.com" },
    });
    for (const value of [
      {},
      { email: 7 },
      { email: "missing-at.example.com" },
      { email: "a@b" },
      { email: `${"a".repeat(250)}@b.com` },
      { email: "player@example.com", password: "forbidden" },
    ]) {
      expect(validateRequestMagicLinkRequest(value).ok).toBe(false);
    }
  });

  test("validates profile names and rejects missing, wrong, empty, oversized, and extra fields", () => {
    expect(validateUpdateMeRequest({ name: "  Alice  " }).ok).toBe(true);
    for (const value of [
      {},
      { name: 1 },
      { name: "   " },
      { name: "x".repeat(65) },
      { name: "Alice", id: "client-controlled" },
    ]) {
      expect(validateUpdateMeRequest(value).ok).toBe(false);
    }
  });

  test("validates room creation bodies", () => {
    expect(
      validateCreateRoomRequest({
        releaseSlugOrId: "tabletop-sandbox",
        visibility: "private",
        displayName: "Host",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateCreateRoomRequest({ releaseSlugOrId: "release_1", visibility: "public" }),
    ).toMatchObject({ ok: true });
    for (const value of [
      {},
      { releaseSlugOrId: 1, visibility: "private" },
      { releaseSlugOrId: "", visibility: "private" },
      { releaseSlugOrId: "x".repeat(129), visibility: "private" },
      { releaseSlugOrId: "game", visibility: "friends" },
      { releaseSlugOrId: "game", visibility: "private", displayName: false },
      { releaseSlugOrId: "game", visibility: "private", ownerId: "spoofed" },
    ]) {
      expect(validateCreateRoomRequest(value).ok).toBe(false);
    }
  });

  test("validates join bodies against the v1 code field", () => {
    expect(validateJoinRoomRequest({ code: "abcd-2345", displayName: "Guest" })).toEqual({
      ok: true,
      value: { code: "abcd-2345", displayName: "Guest" },
    });
    for (const value of [
      {},
      { joinCode: "ABCD-2345" },
      { code: 42 },
      { code: "" },
      { code: "x".repeat(33) },
      { code: "ABCD-2345", displayName: "" },
      { code: "ABCD-2345", playerId: "spoofed" },
    ]) {
      expect(validateJoinRoomRequest(value).ok).toBe(false);
    }
  });

  test("validates quick-play requests with exact keys and bounded names", () => {
    expect(validateQuickPlayRequest({ slug: "dice-dash" })).toEqual({
      ok: true,
      value: { slug: "dice-dash" },
    });
    expect(validateQuickPlayRequest({ slug: "first-deal", displayName: "Guest" }).ok).toBe(true);
    for (const value of [
      {},
      { slug: "Bad Slug" },
      { slug: "ab" },
      { slug: "dice-dash", displayName: "" },
      { slug: "dice-dash", displayName: "x".repeat(65) },
      { slug: "dice-dash", releaseId: "spoofed" },
    ]) expect(validateQuickPlayRequest(value).ok).toBe(false);
  });

  test("validates extended game summaries including metrics and cover signal", () => {
    const summary = {
      slug: "dice-dash", title: "Dice Dash", tagline: "Roll together",
      minPlayers: 2, maxPlayers: 4, builtin: true,
      currentPlayers: 3, totalPlays: 42, coverVersion: 1,
    };
    expect(validateGameSummaryDto(summary)).toEqual({ ok: true, value: summary });
    expect(validateGameSummaryDto({ ...summary, coverVersion: null }).ok).toBe(true);
    const browse = {
      ...summary,
      tags: ["strategy", "hidden-role"],
      playTimeMinutes: 30,
      complexity: 3 as const,
      description: "A complete browse description.",
    };
    expect(validateGameSummaryDto(browse)).toEqual({ ok: true, value: browse });
    for (const value of [
      { ...summary, currentPlayers: -1 },
      { ...summary, totalPlays: 1.5 },
      { ...summary, coverVersion: 0 },
      { ...summary, coverVersion: "1" },
      { ...summary, currentPlayers: 0, unknown: true },
      { ...summary, tags: ["Not a slug"] },
      { ...summary, playTimeMinutes: 0 },
      { ...summary, complexity: 6 },
      { ...summary, description: "" },
    ]) expect(validateGameSummaryDto(value).ok).toBe(false);
  });

  test("validates upload DTOs with caps, slugs, player limits, and exact keys", () => {
    const bundle = validBundle();
    expect(validateCreateGameRequest({
      title: "Tiny Table", tagline: "A small game", slug: "tiny-table",
      minPlayers: 1, maxPlayers: 4, bundle,
    }).ok).toBe(true);
    expect(validateCreateReleaseRequest({ bundle }).ok).toBe(true);
    expect(validateUpdateGameRequest({ visibility: "unlisted" }).ok).toBe(true);
    for (const value of [
      { title: "", tagline: "x", minPlayers: 1, maxPlayers: 4, bundle },
      { title: "x".repeat(81), tagline: "x", minPlayers: 1, maxPlayers: 4, bundle },
      { title: "Game", tagline: "x".repeat(241), minPlayers: 1, maxPlayers: 4, bundle },
      { title: "Game", tagline: "", slug: "Bad_Slug", minPlayers: 1, maxPlayers: 4, bundle },
      { title: "Game", tagline: "", minPlayers: 5, maxPlayers: 4, bundle },
      { title: "Game", tagline: "", minPlayers: 1, maxPlayers: 4, bundle, ownerId: "spoof" },
    ]) expect(validateCreateGameRequest(value).ok).toBe(false);
    expect(validateCreateReleaseRequest({ bundle, releaseNumber: 2 }).ok).toBe(false);
    expect(validateUpdateGameRequest({ visibility: "private" }).ok).toBe(false);
  });

  test("validates exact bounded AI prompt and edit instruction bodies", () => {
    expect(validateCreateAiGameRequest({ prompt: "Build a dice game" })).toEqual({
      ok: true, value: { prompt: "Build a dice game" },
    });
    expect(validateEditAiGameRequest({ instruction: "Add another die" })).toEqual({
      ok: true, value: { instruction: "Add another die" },
    });
    expect(validateCreateAiGameRequest({ prompt: "" }).ok).toBe(false);
    expect(validateEditAiGameRequest({ instruction: " padded " }).ok).toBe(false);
    expect(validateCreateAiGameRequest({ prompt: "valid", bundle: {} }).ok).toBe(false);
  });

  test("aggregates release integrity failures", () => {
    const bundle = validBundle();
    expect(validateReleaseBundle(bundle, { ...VALIDATION, minPlayers: 1, maxPlayers: 4 }).every((item) => item.ok)).toBe(true);
    const invalid = structuredClone(bundle);
    invalid.files[0]!.content = "changed";
    invalid.initialSnapshot.stateHash = "sha256:" + "f".repeat(64);
    invalid.kernelVersion = 2 as 1;
    const failed = validateReleaseBundle(invalid, { ...VALIDATION, minPlayers: 2, maxPlayers: 4 })
      .filter((item) => !item.ok).map((item) => item.check);
    expect(failed).toContain("content_hashes");
    expect(failed).toContain("state_hash");
    expect(failed).toContain("kernel_load");
    expect(failed).toContain("version_pins");
    expect(failed).toContain("player_limits");
  });

  test("pins Lua stdlib v1 additively and defaults legacy bundles", () => {
    const legacy = validBundle();
    expect(effectiveLuaStdlibVersion(legacy)).toBe(1);
    expect(validateReleaseBundle(legacy, VALIDATION).every((item) => item.ok)).toBe(true);

    const current = validBundle();
    current.luaStdlibVersion = 1;
    current.refs = { main_deck: "deck_01" };
    current.integrity.manifestHash = releaseManifestHash(current, fakeHash);
    expect(effectiveLuaStdlibVersion(current)).toBe(1);
    expect(validateReleaseBundle(current, VALIDATION).every((item) => item.ok)).toBe(true);

    const badRefs = structuredClone(current) as unknown as Record<string, unknown>;
    badRefs.refs = { "not-safe!": "deck_01" };
    expect(validateReleaseBundle(badRefs, VALIDATION).find((item) => item.check === "bundle_shape")?.ok).toBe(false);
  });

  test("strictly validates full piece definitions and bounded FaceSpecs", () => {
    const bundle = validBundle();
    const manifestBeforeDefinitions = releaseManifestHash(bundle, fakeHash);
    bundle.definitions = {
      wheat_hex: {
        shape: "hex", size: { w: 2, d: 1.74, h: 0.14 }, color: "#d7b45a", backColor: "#654321",
        label: "Wheat", backLabel: "Hidden", seatTint: false,
        face: { background: "#f4d77b", elements: [{ type: "icon", name: "wheat", x: 500, y: 500, size: 600, fill: "#785d18" }] },
      },
    };
    bundle.integrity.manifestHash = releaseManifestHash(bundle, fakeHash);
    expect(bundle.integrity.manifestHash).toBe(manifestBeforeDefinitions);
    expect(validateReleaseBundle(bundle, VALIDATION).find((item) => item.check === "bundle_shape")?.ok).toBe(true);

    for (const definition of [
      { shape: "sphere" },
      { size: { w: 0.01, d: 1, h: 1 } },
      { color: "red" },
      { label: "bad\u0000label" },
      { face: { background: "#ffffff", elements: [{ type: "image", href: "https://evil.test" }] } },
      { label: "known", onclick: "alert(1)" },
    ]) {
      const invalid = structuredClone(bundle) as unknown as Record<string, unknown>;
      invalid.definitions = { hostile: definition };
      expect(validateReleaseBundle(invalid, VALIDATION).find((item) => item.check === "bundle_shape")?.ok).toBe(false);
    }

    const crowdedFace = { background: "#ffffff", elements: Array.from({ length: 301 }, () => ({ type: "circle", cx: 1, cy: 1, r: 1 })) };
    const normal = structuredClone(bundle);
    normal.definitions = { crowded: { shape: "token", face: crowdedFace } } as NonNullable<ReleaseBundleDto["definitions"]>;
    expect(validateReleaseBundle(normal, VALIDATION).find((item) => item.check === "bundle_shape")?.ok).toBe(false);
    const board = structuredClone(bundle);
    board.definitions = { crowded: { shape: "board", face: crowdedFace } } as NonNullable<ReleaseBundleDto["definitions"]>;
    board.integrity.manifestHash = releaseManifestHash(board, fakeHash);
    expect(validateReleaseBundle(board, VALIDATION).find((item) => item.check === "bundle_shape")?.ok).toBe(true);
  });
});
