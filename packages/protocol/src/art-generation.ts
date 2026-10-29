import type { ArtworkCredits } from "./artwork";
import type { RasterContentType } from "./raster";

export type ArtPurpose = "cover" | "card-back";
export type ArtJobKey = "cover" | "cardBack";
export interface GameArtDirection {
  version: 1;
  style: string;
  coverPrompt: string;
  cardBackPrompt: string;
}
export interface ArtworkGenerationJob {
  status: "pending" | "running" | "unconfigured" | "failed" | "ready" | "not-needed";
  revision: number;
  assetId?: string;
  /** Original belonging to the selected pixels; a failed attempt must not replace it. */
  selectedAssetId?: string;
  originalSha256?: string;
  outputSha256?: string;
  message?: string;
  failureKind?: "provider" | "decode" | "storage";
}
export interface ArtworkGeneration {
  version: 1;
  sourceManifestHash: string;
  direction: GameArtDirection | null;
  jobs: Record<ArtJobKey, ArtworkGenerationJob>;
}
/** Public provenance travels with the selected immutable image information. */
export interface ArtworkGenerationProvenance {
  model: string;
  promptHash: string;
  originalSha256: string;
  generatedAt: string;
}
export interface DraftArtRequest {
  draftId: string;
  title: string;
  purpose: ArtPurpose;
  direction: GameArtDirection;
  revision: number;
}
export interface GeneratedArtwork extends ArtworkGenerationProvenance {
  assetId: string;
  dataUrl: string;
  contentType: RasterContentType;
  width: number;
  height: number;
  byteLength: number;
  credits: ArtworkCredits;
}
export interface ArtDirectionRequest { title: string; rulebook: string }
export interface ArtworkDraftReview {
  manifestHash: string;
  validationReport: Array<{ check: string; ok: boolean; detail?: string }>;
  qualityReport: Array<{ code: string; message: string; severity: "warning" | "error" }>;
}
export const ART_ORIGINAL_MAX_BYTES = 8 * 1024 * 1024;
export const ART_ASSET_ID = /^art_[a-f0-9]{64}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
export function normalizeGameArtDirection(value: unknown): GameArtDirection | null {
  if (!record(value) || !exact(value, ["version", "style", "coverPrompt", "cardBackPrompt"]) || value.version !== 1 ||
    !text(value.style, 1, 1000) || !text(value.coverPrompt, 1, 2000) || !text(value.cardBackPrompt, 0, 2000)) return null;
  return { version: 1, style: value.style, coverPrompt: value.coverPrompt, cardBackPrompt: value.cardBackPrompt };
}
export function normalizeArtworkGenerationProvenance(value: unknown): ArtworkGenerationProvenance | null {
  if (!record(value) || !exact(value, ["model", "promptHash", "originalSha256", "generatedAt"]) ||
    !text(value.model, 1, 120) || typeof value.promptHash !== "string" || !HASH.test(value.promptHash) ||
    typeof value.originalSha256 !== "string" || !HASH.test(value.originalSha256) ||
    typeof value.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))) return null;
  return { model: value.model, promptHash: value.promptHash, originalSha256: value.originalSha256, generatedAt: value.generatedAt };
}
export function normalizeArtworkGeneration(value: unknown): ArtworkGeneration | null {
  if (!record(value) || !exact(value, ["version", "sourceManifestHash", "direction", "jobs"]) || value.version !== 1 ||
    typeof value.sourceManifestHash !== "string" || !HASH.test(value.sourceManifestHash) || !record(value.jobs) || !exact(value.jobs, ["cover", "cardBack"])) return null;
  const direction = value.direction === null ? null : normalizeGameArtDirection(value.direction);
  if (value.direction !== null && !direction) return null;
  const jobs = {} as Record<ArtJobKey, ArtworkGenerationJob>;
  for (const key of ["cover", "cardBack"] as const) {
    const raw = value.jobs[key];
    if (!record(raw) || !exact(raw, ["status", "revision", "assetId", "selectedAssetId", "originalSha256", "outputSha256", "message", "failureKind"]) ||
      !["pending", "running", "unconfigured", "failed", "ready", "not-needed"].includes(String(raw.status)) ||
      !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || (raw.revision as number) > 10_000 ||
      (raw.assetId !== undefined && (typeof raw.assetId !== "string" || !ART_ASSET_ID.test(raw.assetId))) ||
      (raw.selectedAssetId !== undefined && (typeof raw.selectedAssetId !== "string" || !ART_ASSET_ID.test(raw.selectedAssetId))) ||
      ["originalSha256", "outputSha256"].some((hash) => raw[hash] !== undefined && (typeof raw[hash] !== "string" || !HASH.test(raw[hash] as string))) ||
      (raw.message !== undefined && !text(raw.message, 0, 2000)) ||
      (raw.failureKind !== undefined && !["provider", "decode", "storage"].includes(String(raw.failureKind)))) return null;
    jobs[key] = { status: raw.status as ArtworkGenerationJob["status"], revision: raw.revision as number,
      ...(raw.assetId === undefined ? {} : { assetId: raw.assetId as string }),
      ...(raw.selectedAssetId === undefined ? {} : { selectedAssetId: raw.selectedAssetId as string }),
      ...(raw.originalSha256 === undefined ? {} : { originalSha256: raw.originalSha256 as string }),
      ...(raw.outputSha256 === undefined ? {} : { outputSha256: raw.outputSha256 as string }),
      ...(raw.message === undefined ? {} : { message: raw.message as string }),
      ...(raw.failureKind === undefined ? {} : { failureKind: raw.failureKind as NonNullable<ArtworkGenerationJob["failureKind"]> }) };
  }
  return { version: 1, sourceManifestHash: value.sourceManifestHash, direction, jobs };
}
export function normalizeDraftArtRequest(value: unknown): DraftArtRequest | null {
  if (!record(value) || !exact(value, ["draftId", "title", "purpose", "direction", "revision"]) ||
    !text(value.draftId, 1, 180) || !text(value.title, 1, 80) || !["cover", "card-back"].includes(String(value.purpose)) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || (value.revision as number) > 10_000) return null;
  const direction = normalizeGameArtDirection(value.direction);
  if (!direction || (value.purpose === "card-back" && !direction.cardBackPrompt)) return null;
  return { draftId: value.draftId, title: value.title, purpose: value.purpose as ArtPurpose, direction, revision: value.revision as number };
}
export function normalizeArtDirectionRequest(value: unknown): ArtDirectionRequest | null {
  if (!record(value) || !exact(value, ["title", "rulebook"]) || !text(value.title, 1, 80) ||
    typeof value.rulebook !== "string" || value.rulebook.length > 131_072 || new TextEncoder().encode(value.rulebook).length > 131_072 || value.rulebook.includes("\0")) return null;
  return { title: value.title, rulebook: value.rulebook };
}
