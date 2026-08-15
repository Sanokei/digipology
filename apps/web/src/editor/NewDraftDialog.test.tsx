import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NewDraftDialog, newDraftDialogKeyResult } from "./NewDraftDialog";

describe("New Draft picker", () => {
  test("renders all four executable choices as an accessible modal listbox", () => {
    const html = renderToStaticMarkup(<NewDraftDialog onChoose={() => undefined} onClose={() => undefined} />);
    for (const title of ["Blank Table", "Card Game", "Dice Game", "Zone Game"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="listbox"');
  });

  test("supports arrows, Home/End, Enter, Space, and Escape", () => {
    expect(newDraftDialogKeyResult("ArrowRight", 3).selectedIndex).toBe(0);
    expect(newDraftDialogKeyResult("ArrowLeft", 0).selectedIndex).toBe(3);
    expect(newDraftDialogKeyResult("Home", 2).selectedIndex).toBe(0);
    expect(newDraftDialogKeyResult("End", 0).selectedIndex).toBe(3);
    expect(newDraftDialogKeyResult("Enter", 2)).toEqual({ action: "choose", selectedIndex: 2 });
    expect(newDraftDialogKeyResult(" ", 1)).toEqual({ action: "choose", selectedIndex: 1 });
    expect(newDraftDialogKeyResult("Escape", 1)).toEqual({ action: "close", selectedIndex: 1 });
  });
});
