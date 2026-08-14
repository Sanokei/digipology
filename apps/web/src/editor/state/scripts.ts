import { sha256 } from "digipology-canonical-json";
import { rawContentHash, type ReleaseBundleDto, type ReleaseFileDto } from "digipology-protocol/http";

import type { EditorDraft } from "./types";

const SCRIPT_PATH = /^scripts\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.lua$/;

function normalizeName(name: string): string {
  const trimmed = name.trim().replaceAll("\\", "/");
  const path = trimmed.startsWith("scripts/") ? trimmed : `scripts/${trimmed}`;
  return path.endsWith(".lua") ? path : `${path}.lua`;
}

function assertScriptPath(name: string): string {
  const path = normalizeName(name);
  if (!SCRIPT_PATH.test(path) || path.includes("..") || path.includes("//")) {
    throw new TypeError("Script names must be safe .lua paths under scripts/.");
  }
  return path;
}

export function scriptNameMatchesPath(name: string, path: string): boolean {
  try { return assertScriptPath(name) === path; }
  catch { return false; }
}

function releaseFile(path: string, content: string): ReleaseFileDto {
  return {
    path,
    content,
    byteLength: new TextEncoder().encode(content).byteLength,
    contentHash: rawContentHash(content, sha256),
  };
}

export function scriptFiles(bundle: ReleaseBundleDto): ReleaseFileDto[] {
  return bundle.files.filter((file) => file.path.startsWith("scripts/") && file.path.endsWith(".lua"))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function scriptContent(draft: EditorDraft, path: string): string | null {
  return draft.bundle.files.find((file) => file.path === path)?.content ?? null;
}

export function createScript(draft: EditorDraft, name: string, content = ""): string {
  const path = assertScriptPath(name);
  if (draft.bundle.files.some((file) => file.path === path)) throw new TypeError(`Script already exists: ${path}`);
  draft.bundle.files = [...draft.bundle.files, releaseFile(path, content)]
    .sort((left, right) => left.path.localeCompare(right.path));
  return path;
}

export function renameScript(draft: EditorDraft, currentPath: string, name: string): string {
  const path = assertScriptPath(name);
  const index = draft.bundle.files.findIndex((file) => file.path === currentPath);
  if (index < 0) throw new TypeError(`Unknown script: ${currentPath}`);
  if (path !== currentPath && draft.bundle.files.some((file) => file.path === path)) {
    throw new TypeError(`Script already exists: ${path}`);
  }
  const current = draft.bundle.files[index]!;
  draft.bundle.files[index] = releaseFile(path, current.content);
  draft.bundle.files.sort((left, right) => left.path.localeCompare(right.path));
  return path;
}

export function deleteScript(draft: EditorDraft, path: string): void {
  const next = draft.bundle.files.filter((file) => file.path !== path);
  if (next.length === draft.bundle.files.length) throw new TypeError(`Unknown script: ${path}`);
  draft.bundle.files = next;
}

export function updateScript(draft: EditorDraft, path: string, content: string): void {
  const index = draft.bundle.files.findIndex((file) => file.path === path);
  if (index < 0) throw new TypeError(`Unknown script: ${path}`);
  draft.bundle.files[index] = releaseFile(path, content);
}
