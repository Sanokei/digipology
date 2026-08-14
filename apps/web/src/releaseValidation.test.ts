import { describe, expect, test } from "bun:test";
import { hashValue, sha256 } from "digipology-canonical-json";
import { createInitialState, snapshot } from "digipology-kernel";
import { rawContentHash, releaseManifestHash, type ReleaseBundleDto } from "digipology-protocol/http";
import { prevalidateCreateGame, prevalidateRelease } from "./releaseValidation";

function bundle(): ReleaseBundleDto {
  const content = "{}";
  const state = createInitialState({
    releaseId: "draft_release",
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
  });
  const value: ReleaseBundleDto = {
    formatVersion: 1, gameId: "draft_game", releaseId: "draft_release", releaseNumber: 1,
    kernelVersion: 1, luaApiVersion: 1, networkProtocolVersion: 1,
    interactionMode: "sandbox", minPlayers: 2, maxPlayers: 4,
    files: [{ path: "runtime/game.json", contentHash: rawContentHash(content, sha256), byteLength: 2, content }],
    integrity: { manifestHash: "sha256:" + "0".repeat(64) },
    initialSnapshot: snapshot(state) as unknown as ReleaseBundleDto["initialSnapshot"],
  };
  value.integrity.manifestHash = releaseManifestHash(value, hashValue);
  return value;
}

describe("browser release pre-validation", () => {
  test("accepts the same valid integrity chain used by the Worker", () => {
    const checked = prevalidateCreateGame({
      title: "Community Table", tagline: "Play together", slug: "community-table",
      minPlayers: 2, maxPlayers: 4,
    }, JSON.stringify(bundle()));
    expect(checked.request).not.toBeNull();
    expect(checked.report.every((item) => item.ok)).toBe(true);
  });

  test("blocks malformed JSON and aggregates hash failures", () => {
    expect(prevalidateRelease("{", 2, 4).report.find((item) => item.check === "canonical_json"))
      .toMatchObject({ ok: false });
    const invalid = bundle();
    invalid.files[0]!.content = "bad";
    invalid.initialSnapshot.stateHash = "sha256:" + "f".repeat(64);
    const failed = prevalidateRelease(JSON.stringify(invalid), 2, 4).report
      .filter((item) => !item.ok).map((item) => item.check);
    expect(failed).toEqual(expect.arrayContaining(["content_hashes", "state_hash", "kernel_load"]));
  });
});

