import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OpenDraftDialog, draftDialogKeyResult } from "./OpenDraftDialog";

const drafts = [
  { version: 1 as const, id: "recent", title: "Recent Game", updatedAt: "2026-03-02T00:00:00.000Z" },
  { version: 1 as const, id: "older", title: "Older Game", updatedAt: "2026-03-01T00:00:00.000Z" },
];

describe("OpenDraftDialog", () => {
  test("renders draft titles and ids in the supplied recent-first order", () => {
    const html = renderToStaticMarkup(<OpenDraftDialog drafts={drafts} onOpen={() => undefined} onClose={() => undefined} />);
    expect(html).toContain("Recent Game");
    expect(html).toContain("recent");
    expect(html.indexOf("Recent Game")).toBeLessThan(html.indexOf("Older Game"));
    expect(html).toContain('aria-modal="true"');
  });

  test("Enter opens the selected draft and Escape dismisses without choosing one", () => {
    const enter = draftDialogKeyResult("Enter", 1, drafts.length);
    expect(enter).toEqual({ action: "open", selectedIndex: 1 });
    expect(drafts[enter.selectedIndex]!.id).toBe("older");
    expect(draftDialogKeyResult("Escape", 1, drafts.length)).toEqual({ action: "close", selectedIndex: 1 });
  });

  test("arrow keys wrap keyboard selection", () => {
    expect(draftDialogKeyResult("ArrowDown", 1, drafts.length).selectedIndex).toBe(0);
    expect(draftDialogKeyResult("ArrowUp", 0, drafts.length).selectedIndex).toBe(1);
  });
});
