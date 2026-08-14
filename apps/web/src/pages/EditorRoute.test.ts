import { expect, test } from "bun:test";

import { isDesktopEditorEnvironment } from "./EditorRoute";

test("editor route requires both desktop width and a fine pointer", () => {
  const desktop = { matchMedia: () => ({ matches: true }) } as unknown as Pick<Window, "matchMedia">;
  const mobile = { matchMedia: () => ({ matches: false }) } as unknown as Pick<Window, "matchMedia">;
  expect(isDesktopEditorEnvironment(desktop)).toBe(true);
  expect(isDesktopEditorEnvironment(mobile)).toBe(false);
  expect(isDesktopEditorEnvironment(undefined)).toBe(false);
});
