import { describe, expect, test } from "bun:test";
import type { ReleaseBundleDto } from "digipology-protocol/http";
import { builtinCatalog } from "./catalog";
import { prepareUploadedBundle, validateUploadedBundle } from "./release-validation";

function fixture(): ReleaseBundleDto {
  return structuredClone(builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle) as ReleaseBundleDto;
}

describe("uploaded release validation", () => {
  test("accepts a built-in-derived fixture and normalizes immutable server IDs", () => {
    const draft = fixture();
    expect(validateUploadedBundle(draft, 2, 4).every((item) => item.ok)).toBe(true);
    const prepared = prepareUploadedBundle(draft, {
      gameId: "game_server", releaseId: "release_server", releaseNumber: 3, title: "Community Dice",
    });
    expect(prepared.bundle).toMatchObject({
      gameId: "game_server", releaseId: "release_server", releaseNumber: 3, title: "Community Dice",
      initialSnapshot: { releaseId: "release_server", sequence: 0, state: { releaseId: "release_server", players: {} } },
    });
    expect(prepared.bundle.integrity.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(validateUploadedBundle(prepared.bundle, 2, 4).every((item) => item.ok)).toBe(true);
  });

  test("reports every failed integrity stage instead of stopping at the first", () => {
    const draft = fixture();
    draft.files[0]!.content += "corrupt";
    draft.integrity.manifestHash = "sha256:" + "0".repeat(64);
    draft.initialSnapshot.stateHash = "sha256:" + "f".repeat(64);
    draft.networkProtocolVersion = 2 as 1;
    const failed = validateUploadedBundle(draft, 1, 8).filter((item) => !item.ok).map((item) => item.check);
    expect(failed).toEqual(expect.arrayContaining([
      "content_hashes", "manifest_hash", "state_hash", "kernel_load", "version_pins", "player_limits",
    ]));
  });

  test("names shape failures for unknown fields", () => {
    const draft = { ...fixture(), executable: true };
    expect(validateUploadedBundle(draft, 2, 4).find((item) => item.check === "bundle_shape"))
      .toMatchObject({ ok: false, detail: "unknown field executable" });
  });
});

