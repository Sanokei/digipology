import { describe, expect, test } from "bun:test";

import { normalizeEditorFields, resizeDieFaces } from "./InspectorPanel";

describe("die side editing", () => {
  test("growing preserves custom faces and extends with positional integer defaults", () => {
    expect(resizeDieFaces(["a", "b", "c"], 4)).toEqual(["a", "b", "c", 4]);
  });

  test("shrinking truncates without rewriting the surviving custom faces", () => {
    expect(resizeDieFaces(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  test("default dice retain the existing 1 through N semantics", () => {
    const die: Record<string, unknown> = { definitionId: "standard_d6", value: "1", faces: [1, 2, 3, 4, 5, 6], sidesEditor: 6 };
    normalizeEditorFields("die", die);
    expect(die).toEqual({ definitionId: "standard_d6", value: 1, faces: [1, 2, 3, 4, 5, 6] });
  });
});
