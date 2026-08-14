import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import {
  createInitialState,
  snapshot,
  type CanonicalGameState,
} from "digipology-kernel";
import {
  rawContentHash,
  releaseManifestHash,
  type ReleaseBundleDto,
} from "digipology-protocol/http";

import { prevalidateRelease } from "../../releaseValidation";
import type { EditorDraft } from "./types";
import { createScript } from "./scripts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "_").replaceAll(/^_+|_+$/g, "");
  return (normalized || "draft").slice(0, 96);
}

export function rebuildDraftIntegrity(draft: EditorDraft): void {
  const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
  draft.bundle.title = draft.title;
  draft.bundle.minPlayers = draft.minPlayers;
  draft.bundle.maxPlayers = draft.maxPlayers;
  draft.bundle.initialSnapshot = snapshot(state) as unknown as ReleaseBundleDto["initialSnapshot"];
  draft.bundle.integrity.manifestHash = releaseManifestHash(draft.bundle, hashValue);
}

export function createEmptyEditorDraft(id: string, now = new Date().toISOString()): EditorDraft {
  const suffix = draftIdentifier(id);
  const releaseId = `draft_${suffix}_1`;
  const content = "{}";
  const state = createInitialState({
    releaseId,
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
  });
  const bundle: ReleaseBundleDto = {
    formatVersion: 1,
    gameId: `draft_${suffix}`,
    releaseId,
    releaseNumber: 1,
    kernelVersion: 1,
    luaApiVersion: 1,
    networkProtocolVersion: 1,
    interactionMode: "sandbox",
    minPlayers: 1,
    maxPlayers: 4,
    files: [{
      path: "runtime/game.json",
      content,
      byteLength: new TextEncoder().encode(content).byteLength,
      contentHash: rawContentHash(content, sha256),
    }],
    integrity: { manifestHash: `sha256:${"0".repeat(64)}` },
    initialSnapshot: snapshot(state) as unknown as ReleaseBundleDto["initialSnapshot"],
    title: "Untitled Game",
    definitions: {},
  };
  const draft: EditorDraft = {
    editorVersion: 1,
    id,
    title: "Untitled Game",
    tagline: "",
    slug: "",
    minPlayers: 1,
    maxPlayers: 4,
    createdAt: now,
    updatedAt: now,
    bundle,
  };
  createScript(draft, "game.lua", "");
  bundle.integrity.manifestHash = releaseManifestHash(bundle, hashValue);
  return draft;
}

export function normalizeReleaseBundle(value: unknown): ReleaseBundleDto {
  const text = canonicalStringify(value);
  if (!isRecord(value)) throw new TypeError("The bundle must be a JSON object.");
  const minPlayers = value.minPlayers;
  const maxPlayers = value.maxPlayers;
  if (!Number.isSafeInteger(minPlayers) || !Number.isSafeInteger(maxPlayers)) {
    throw new TypeError("The bundle player limits are missing or invalid.");
  }
  const checked = prevalidateRelease(text, minPlayers as number, maxPlayers as number);
  if (checked.bundle === null) {
    const failed = checked.report.find((item) => !item.ok);
    throw new TypeError(failed?.detail ?? `The bundle failed ${failed?.check.replaceAll("_", " ") ?? "validation"}.`);
  }
  return checked.bundle;
}

export function normalizeEditorDraft(value: unknown): EditorDraft {
  if (!isRecord(value) || value.editorVersion !== 1) {
    throw new TypeError("This is not a supported editor draft.");
  }
  const requiredStrings = ["id", "title", "tagline", "slug", "createdAt", "updatedAt"] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string") throw new TypeError(`Draft ${field} is invalid.`);
  }
  if ((value.id as string).trim() === "" || (value.title as string).trim() === "") {
    throw new TypeError("Draft id and title cannot be empty.");
  }
  if (!Number.isSafeInteger(value.minPlayers) || !Number.isSafeInteger(value.maxPlayers)) {
    throw new TypeError("Draft player limits are invalid.");
  }
  const bundle = normalizeReleaseBundle(value.bundle);
  if (value.minPlayers !== bundle.minPlayers || value.maxPlayers !== bundle.maxPlayers) {
    throw new TypeError("Draft and bundle player limits do not match.");
  }
  const strings = value as Record<(typeof requiredStrings)[number], string> & Record<string, unknown>;
  return structuredClone({
    editorVersion: 1,
    id: strings.id,
    title: strings.title,
    tagline: strings.tagline,
    slug: strings.slug,
    minPlayers: value.minPlayers,
    maxPlayers: value.maxPlayers,
    createdAt: strings.createdAt,
    updatedAt: strings.updatedAt,
    bundle,
  } satisfies EditorDraft);
}

export function importBundleAsDraft(
  text: string,
  id: string,
  now = new Date().toISOString(),
): EditorDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("That file is not valid JSON.");
  }
  const bundle = normalizeReleaseBundle(parsed);
  return {
    editorVersion: 1,
    id,
    title: bundle.title ?? "Imported Game",
    tagline: "",
    slug: "",
    minPlayers: bundle.minPlayers,
    maxPlayers: bundle.maxPlayers,
    createdAt: now,
    updatedAt: now,
    bundle: structuredClone(bundle),
  };
}

export function exportBundleText(draft: EditorDraft): string {
  return canonicalStringify(draft.bundle);
}
