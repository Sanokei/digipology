import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RulebookDialog, rulebookBlocks } from "./RulebookDialog";

test("the player rulebook renders headings, actions and victory lists as readable content", () => {
  expect(rulebookBlocks("# Goal\nCollect three cards.\n\n1. Draw a card\n2. Trade\n\n- Reach three points")).toEqual([
    { kind: "heading", text: "Goal" }, { kind: "paragraph", text: "Collect three cards." },
    { kind: "list", ordered: true, items: ["Draw a card", "Trade"] },
    { kind: "list", ordered: false, items: ["Reach three points"] },
  ]);
});
test("authored markup stays inert text and a missing guide is explicit", () => {
  const html = renderToStaticMarkup(<RulebookDialog title="A game" rulebook={{ title: "A game", source: "release", body: '<script>alert("bad")</script>' }} onClose={() => {}} />);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(renderToStaticMarkup(<RulebookDialog title="Old game" rulebook={null} onClose={() => {}} />)).toContain("No rulebook was included");
});
