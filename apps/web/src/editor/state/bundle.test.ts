import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "digipology-canonical-json";
import type { CanonicalGameState } from "digipology-kernel";

import { addComponent, removeComponent } from "./actions/components";
import { exportBundleText, importBundleAsDraft, normalizeEditorDraft } from "./bundle";
import { editorTestDraft } from "./testFixtures";

describe("editor bundle adaptation", () => {
  test("round-trips a fixture through normalization with canonical equality", () => {
    const draft = editorTestDraft();
    const normalized = normalizeEditorDraft(JSON.parse(canonicalStringify(draft)) as unknown);
    expect(canonicalStringify(normalized)).toBe(canonicalStringify(draft));
    const imported = importBundleAsDraft(exportBundleText(draft), "imported", "2026-01-01T00:00:00.000Z");
    expect(canonicalStringify(imported.bundle)).toBe(canonicalStringify(draft.bundle));
  });

  test("adds required components and blocks removal while depended upon", () => {
    const draft = editorTestDraft();
    const entities = (draft.bundle.initialSnapshot.state as CanonicalGameState).entities;
    entities.empty = { id: "empty", components: {} };
    expect(addComponent(draft, "empty", "card")).toBe(true);
    expect(entities.empty!.components.transform).toBeDefined();
    expect(removeComponent(draft, "empty", "transform")).toEqual({ ok: false, reason: "transform is required by card." });
    expect(removeComponent(draft, "empty", "card")).toEqual({ ok: true });
    expect(removeComponent(draft, "empty", "transform")).toEqual({ ok: true });
  });

  test("stores only explicit position, rotation, and scale transform fields", () => {
    const draft = editorTestDraft();
    const transform = (draft.bundle.initialSnapshot.state as CanonicalGameState).entities.card_a!.components.transform!;
    expect(Object.keys(transform).sort()).toEqual(["position", "rotation", "scale"]);
    expect(transform.position).toEqual({ x: 0, y: 0.2, z: 0 });
  });
});
