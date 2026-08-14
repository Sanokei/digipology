import { expect, test } from "bun:test";

import { nextTreeKeyboardState, type TreeKeyboardState } from "./useTreeKeyboard";

test("tree keyboard navigation supports arrows, Home, End, and typeahead", () => {
  const ids = ["alpha", "beta", "gamma"];
  const start: TreeKeyboardState = { focusId: "alpha", typeahead: "", typeaheadAt: 0 };
  const down = nextTreeKeyboardState(start, { key: "ArrowDown", now: 1 }, ids, (id) => id);
  expect(down.focusId).toBe("beta");
  expect(nextTreeKeyboardState(down, { key: "End", now: 2 }, ids, (id) => id).focusId).toBe("gamma");
  expect(nextTreeKeyboardState(down, { key: "Home", now: 3 }, ids, (id) => id).focusId).toBe("alpha");
  expect(nextTreeKeyboardState(start, { key: "g", now: 4 }, ids, (id) => id).focusId).toBe("gamma");
  expect(nextTreeKeyboardState({ ...start, focusId: null }, { key: "ArrowDown", now: 5 }, ids, (id) => id).focusId).toBe("alpha");
});
