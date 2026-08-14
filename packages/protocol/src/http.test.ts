import { describe, expect, test } from "bun:test";
import {
  rawContentHash,
  releaseManifestHash,
  validateCreateGameRequest,
  validateCreateReleaseRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  validateRequestMagicLinkRequest,
  validateReleaseBundle,
  validateUpdateGameRequest,
  validateUpdateMeRequest,
  type GameSnapshotDto,
  type ReleaseBundleDto,
} from "./http";

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
});
