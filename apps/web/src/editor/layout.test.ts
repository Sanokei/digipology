import { expect, test } from "bun:test";

import { createDefaultEditorLayout, loadEditorLayout, sanitizeStoredLayout } from "./layout";

test("restores persisted layout and drops unknown panels", () => {
  const persisted = createDefaultEditorLayout();
  const center = (persisted.layout.children[1] as { children: Array<{ children: unknown[] }> }).children[0]!;
  center.children.push({ type: "tab", id: "legacy", name: "Legacy", component: "not-a-panel" });
  const sanitized = sanitizeStoredLayout(persisted)!;
  expect(JSON.stringify(sanitized)).not.toContain("not-a-panel");
  expect(JSON.stringify(sanitized)).toContain("viewport");
  expect(loadEditorLayout(JSON.stringify(persisted))).toEqual(sanitized);
});

test("falls back to the declarative default for corrupt layouts", () => {
  expect(loadEditorLayout("{")).toEqual(createDefaultEditorLayout());
});
