import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import { loadSnapshot, snapshot, type CanonicalGameState, type GameSnapshot } from "digipology-kernel";
import {
  UPLOAD_BODY_LIMIT,
  isGameSlug,
  slugifyGameTitle,
  validateCreateGameRequest,
  validateReleaseBundle,
  type CreateGameRequest,
  type ReleaseBundleDto,
  type UploadValidationReportItem,
} from "digipology-protocol/http";

export interface CreateGameDraft {
  title: string;
  tagline: string;
  slug: string;
  minPlayers: number;
  maxPlayers: number;
}

export function prevalidateCreateGame(
  draft: CreateGameDraft,
  bundleText: string,
): { report: UploadValidationReportItem[]; request: CreateGameRequest | null } {
  let bundle: unknown = null;
  let parseError: string | undefined;
  try { bundle = JSON.parse(bundleText) as unknown; }
  catch (error) { parseError = error instanceof Error ? error.message : String(error); }
  const input = {
    title: draft.title,
    tagline: draft.tagline,
    ...(draft.slug === "" ? {} : { slug: draft.slug }),
    minPlayers: draft.minPlayers,
    maxPlayers: draft.maxPlayers,
    bundle,
  };
  const dto = validateCreateGameRequest(input);
  const bytes = new TextEncoder().encode(parseError === undefined ? JSON.stringify(input) : bundleText).byteLength;
  const slug = draft.slug === "" ? slugifyGameTitle(draft.title) : draft.slug;
  const bundleReport = validateReleaseBundle(bundle, {
    minPlayers: draft.minPlayers,
    maxPlayers: draft.maxPlayers,
    canonicalStringify,
    hashValue,
    sha256,
    snapshotStateHash: (state) => snapshot(state as CanonicalGameState).stateHash,
    loadSnapshot: (candidate) => loadSnapshot(candidate as unknown as GameSnapshot),
  });
  if (parseError !== undefined) {
    const canonical = bundleReport.find((item) => item.check === "canonical_json");
    if (canonical !== undefined) Object.assign(canonical, { ok: false, detail: parseError });
  }
  const report: UploadValidationReportItem[] = [
    bytes <= UPLOAD_BODY_LIMIT
      ? { check: "size", ok: true }
      : { check: "size", ok: false, detail: `request body exceeds ${UPLOAD_BODY_LIMIT} bytes` },
    dto.ok
      ? { check: "dto_shape", ok: true }
      : { check: "dto_shape", ok: false, detail: dto.error.message },
    isGameSlug(slug)
      ? { check: "slug", ok: true, detail: "uniqueness is checked by the server" }
      : { check: "slug", ok: false, detail: "slug format is invalid" },
    ...bundleReport,
  ];
  return {
    report,
    request: dto.ok && report.every((item) => item.ok) ? dto.value : null,
  };
}

export function prevalidateRelease(
  bundleText: string,
  minPlayers: number,
  maxPlayers: number,
): { report: UploadValidationReportItem[]; bundle: ReleaseBundleDto | null } {
  let value: unknown = null;
  let parseError: string | undefined;
  try { value = JSON.parse(bundleText) as unknown; }
  catch (error) { parseError = error instanceof Error ? error.message : String(error); }
  const report = validateReleaseBundle(value, {
    minPlayers,
    maxPlayers,
    canonicalStringify,
    hashValue,
    sha256,
    snapshotStateHash: (state) => snapshot(state as CanonicalGameState).stateHash,
    loadSnapshot: (candidate) => loadSnapshot(candidate as unknown as GameSnapshot),
  });
  const bytes = new TextEncoder().encode(parseError === undefined ? JSON.stringify({ bundle: value }) : bundleText).byteLength;
  report.unshift(bytes <= UPLOAD_BODY_LIMIT
    ? { check: "size", ok: true }
    : { check: "size", ok: false, detail: `request body exceeds ${UPLOAD_BODY_LIMIT} bytes` });
  if (parseError !== undefined) {
    const canonical = report.find((item) => item.check === "canonical_json");
    if (canonical !== undefined) Object.assign(canonical, { ok: false, detail: parseError });
  }
  return {
    report,
    bundle: report.every((item) => item.ok) ? value as ReleaseBundleDto : null,
  };
}
