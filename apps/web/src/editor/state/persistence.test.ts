import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "digipology-canonical-json";

import { deserializeDraftIndex, deserializeEditorDraft, loadEditorDraft, saveEditorDraft } from "./persistence";
import { editorTestDraft } from "./testFixtures";
import type { StorageLike } from "./types";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("editor draft persistence", () => {
  test.each([
    ["corrupt JSON", "{"],
    ["wrong top-level shape", "{}"],
    ["version missing", JSON.stringify([{ id: "a", title: "A", updatedAt: "now" }])],
  ])("returns a calm empty index for %s", (_name, raw) => {
    expect(deserializeDraftIndex(raw)).toEqual([]);
  });

  test("skips one bad index entry among good entries", () => {
    const messages: string[] = [];
    const raw = JSON.stringify([
      { version: 1, id: "good", title: "Good", updatedAt: "2026-01-01" },
      { version: 2, id: "bad" },
    ]);
    expect(deserializeDraftIndex(raw, (message) => messages.push(message))).toEqual([
      { version: 1, id: "good", title: "Good", updatedAt: "2026-01-01" },
    ]);
    expect(messages).toHaveLength(1);
  });

  test("saves and reloads byte-equivalent canonical drafts", () => {
    const storage = new MemoryStorage();
    const draft = editorTestDraft();
    saveEditorDraft(storage, draft);
    const loaded = loadEditorDraft(storage, draft.id);
    expect(loaded).not.toBeNull();
    expect(canonicalStringify(loaded)).toBe(canonicalStringify(draft));
  });

  test("rejects corrupt or versionless per-draft blobs", () => {
    expect(deserializeEditorDraft("{")).toBeNull();
    expect(deserializeEditorDraft(JSON.stringify({ id: "legacy" }))).toBeNull();
  });
});
