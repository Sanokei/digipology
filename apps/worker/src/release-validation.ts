import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import { loadSnapshot, snapshot, type CanonicalGameState, type GameSnapshot } from "digipology-kernel";
import {
  releaseManifestHash,
  validateReleaseBundle,
  type ReleaseBundleDto,
  type UploadValidationReportItem,
} from "digipology-protocol/http";

export function validateUploadedBundle(
  value: unknown,
  minPlayers: number,
  maxPlayers: number,
): UploadValidationReportItem[] {
  return validateReleaseBundle(value, {
    minPlayers,
    maxPlayers,
    canonicalStringify,
    hashValue,
    sha256,
    snapshotStateHash: (state) => snapshot(state as CanonicalGameState).stateHash,
    loadSnapshot: (candidate) => loadSnapshot(candidate as unknown as GameSnapshot),
  });
}

/**
 * Bind a validated draft to immutable server IDs. Runtime player membership is
 * room-owned, so uploaded snapshots are normalized to unoccupied seats.
 */
export function prepareUploadedBundle(
  draft: ReleaseBundleDto,
  input: {
    gameId: string;
    releaseId: string;
    releaseNumber: number;
    title: string;
  },
): { bundle: ReleaseBundleDto; canonicalJson: string } {
  const loaded = loadSnapshot(draft.initialSnapshot as unknown as GameSnapshot);
  const state = structuredClone(loaded) as CanonicalGameState;
  state.releaseId = input.releaseId;
  state.sequence = 0;
  state.players = {};
  for (const seat of Object.values(state.seats)) seat.playerId = null;
  const initialSnapshot = snapshot(state);
  const bundle: ReleaseBundleDto = {
    ...draft,
    gameId: input.gameId,
    releaseId: input.releaseId,
    releaseNumber: input.releaseNumber,
    title: input.title,
    initialSnapshot: initialSnapshot as unknown as ReleaseBundleDto["initialSnapshot"],
    files: draft.files.map((file) => ({ ...file })),
    integrity: { manifestHash: "sha256:" + "0".repeat(64) },
  };
  bundle.integrity.manifestHash = releaseManifestHash(bundle, hashValue);
  return { bundle, canonicalJson: canonicalStringify(bundle) };
}
