import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InspectOverlay } from "./InspectOverlay";
import type { DesignedCard } from "../scene/cardDesigns";

const design: DesignedCard = { family: { id: "public-family", label: "Public back family", color: "#245b40" }, card: { definitionId: "private-definition", familyId: "public-family", title: "Unrevealed potion", typeLine: "Secret type", cost: "Secret ingredients", condition: "Secret condition", rulesText: "Private full effect", flavor: "Private flavor", fields: [{ label: "Private key", value: "Private value" }] }, illustration: { key: "private-image", title: "Private front title", src: "data:image/png;base64,cHJpdmF0ZQ==", width: 768, height: 512 } };
test("the hidden inspection guard ignores even supplied untrusted rich fronts and all printed fields", () => {
  const html = renderToStaticMarkup(<InspectOverlay item={{ entityId: "c", kind: "card", label: "Unrevealed potion", color: "#ab1234", hidden: true, design }} onDismiss={() => {}} />);
  expect(html).toContain("Inspecting Face-down card"); expect(html).not.toMatch(/Unrevealed potion|Secret|Private|ab1234|designed-card|private-image|cHJpdmF0ZQ/);
});
test("an authorized rich front retains full, escaped printed rules in accessible inspection", () => {
  const html = renderToStaticMarkup(<InspectOverlay item={{ entityId: "c", kind: "card", label: design.card.title, color: "#245b40", hidden: false, design: { ...design, card: { ...design.card, rulesText: "<script> is quoted source text, not markup. " + "Full effect. ".repeat(300) + "FINAL RULE." } } }} onDismiss={() => {}} />);
  expect(html).toContain('aria-label="Full card rules"'); expect(html).toContain("FINAL RULE."); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain("Secret ingredients");
});

test("repairing a saved ready image with remote or mismatched bytes never mounts that untrusted image", async () => {
  const { ArtworkDialog } = await import("./ArtworkDialog");
  const html = renderToStaticMarkup(<ArtworkDialog title="Private repair" purpose="card-illustration" artwork={{ status: "ready", info: { formatVersion: 1, contentType: "image/png", width: 768, height: 512, sha256: "sha256:" + "0".repeat(64), credits: { artist: "Retained credit", license: "Authored", sourceUrl: "" } }, dataUrl: "https://untrusted-image.example/leak" }} onSave={async () => {}} onClose={() => {}} />);
  expect(html).not.toContain("untrusted-image.example"); expect(html).not.toContain("<img"); expect(html).toContain("Saved artwork could not be read"); expect(html).toContain("Retained credit");
});
