import { canResumeCardArtwork } from "../../artwork/model";
import { compileDraftForPlaytest } from "../playtest/runtime";
import { expect, test } from "bun:test";
import { hashValue, sha256 } from "digipology-canonical-json";
import { CARD_DESIGNS_PATH, parseCardDesigns, cardImageBytes, assembleCardDesignPlan, type CardDesigns } from "digipology-protocol";
import { rawContentHash } from "digipology-protocol/http";
import { rasterPng } from "../../../../../packages/protocol/src/raster.fixture";
import { createCardGameEditorDraft, importBundleAsDraft, rebuildDraftIntegrity, exportBundleText } from "./bundle";
import { attachCardDesigns, withCardImage } from "./cardDesigns";
import { normalizeEditorDraft } from "./bundle";
import { prevalidateRelease } from "../../releaseValidation";
import { KernelStore } from "../../state/kernelStore";
import { designedCard, entityCardBack, readCardDesigns } from "../../scene/cardDesigns";
import { cardArtwork } from "../../scene/pieceArtwork";
import { piecePresentation, pieceSurfaceLayout } from "../../scene/piecePresentation";
import { localHandItems } from "../../pages/tableHandModel";
import { EditorStore } from "./EditorStore";
import { artworkDataUrl, artworkHash } from "./artworkData";
import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

function fixture() {
  const draft = createCardGameEditorDraft("printed-test");
  const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
  const ids = Object.keys(draft.bundle.definitions!).slice(0, 2);
  const designs: CardDesigns = { kind: "digipology-card-designs", version: 1,
    families: [{ id: "a", label: "Family A", color: "#245b40" }, { id: "b", label: "Family B", color: "#753627" }], assets: [], decks: [{ entityId: "main_deck", familyId: "b" }],
    cards: ids.map((id, i) => ({ definitionId: id, familyId: i === 0 ? "a" : "b", title: `Printed secret ${i}`, typeLine: "Potion", cost: "Tea + stone", condition: "At dawn", rulesText: "An explicitly printed effect.", flavor: "Flavor", fields: [{ label: "Value", value: "4" }] })) };
  for (const [targetId, color] of [["a", [30, 80, 60, 255]], ["b", [130, 50, 40, 255]]] as const) {
    const bytes = rasterPng(32, 48, [...color]);
    const artwork = { status: "ready" as const, dataUrl: artworkDataUrl(bytes, "image/png"), info: { formatVersion: 1 as const, contentType: "image/png" as const, width: 32, height: 48, sha256: artworkHash(bytes), credits: { artist: "Authored test raster", license: "Technical fixture", sourceUrl: "" } } };
    Object.assign(designs, withCardImage(designs, { kind: "family-back", targetId }, artwork));
  }
  return { draft, state, ids, designs };
}
test("explicit card families retain different backs after a cross-deck move; actual LAST top wins and unknown cards do not inherit the container", () => {
  const { designs, ids } = fixture();
  const a: EntityRecord = { id: "a", components: { card: { definitionId: ids[0]!, faceUp: false } } };
  const b: EntityRecord = { id: "b", components: { card: { definitionId: ids[1]!, faceUp: false } } };
  const deck: EntityRecord = { id: "main_deck", components: { deck: { enabled: true }, container: { items: ["b", "a"], ordering: "stack", capacity: 52, visibility: "public" } } };
  const entities = { a, b, deck }, fallback = { key: "pending", title: "Pending", src: "", width: 768, height: 1152, pending: true as const };
  const backA = entityCardBack(designs, a, entities, fallback), backB = entityCardBack(designs, b, entities, fallback);
  expect(backA.src).not.toBe(backB.src); expect(entityCardBack(designs, deck, entities, fallback)).toEqual(backA);
  deck.components.container!.items = []; expect(entityCardBack(designs, deck, entities, fallback)).toEqual(backB);
  deck.components.container!.items = ["a"]; expect(entityCardBack(designs, a, entities, fallback)).toEqual(backA);
  a.components.card!.definitionId = "unknown"; expect(entityCardBack(designs, deck, entities, fallback)).toEqual(fallback);
  a.components.card!.definitionId = ids[0]!;
  const surfaces = pieceSurfaceLayout(a, piecePresentation(a, { label: "Unrevealed secret" }), { label: "Unrevealed secret" }, { designs, entities, back: fallback });
  expect(JSON.stringify(surfaces)).not.toMatch(/Printed secret|Unrevealed secret|Tea|Potion|At dawn/);
  expect(surfaces[0]!.artwork).toMatchObject({ kind: "card-back", back: backA });
  expect(cardArtwork(a, {}, designedCard(designs, ids[0]))).toEqual({ kind: "card-back" });
  a.components.card!.faceUp = true; expect(cardArtwork(a, {}, designedCard(designs, ids[0])).kind).toBe("designed-card");
});

test("admission validates real bindings, duplicate IDs, purposes, hashes, dimensions, unsupported/remote media and bounded fields", () => {
  const { designs, draft, state } = fixture();
  const parse = (d: CardDesigns) => parseCardDesigns(JSON.stringify(d), sha256, { definitions: draft.bundle.definitions!, entities: state.entities });
  expect(parse(designs)).toEqual(designs);
  const longTarget = "family-" + "x".repeat(121), longFamily = structuredClone(designs);
  longFamily.families[0]!.id = longTarget; longFamily.cards[0]!.familyId = longTarget;
  const withLongImage = withCardImage(longFamily, { kind: "family-back", targetId: longTarget }, designs.assets[0]!.artwork);
  expect(parse(withLongImage).families[0]!.backAssetId!.length).toBeLessThanOrEqual(128);
  expect(withCardImage(withLongImage, { kind: "family-back", targetId: longTarget }, designs.assets[1]!.artwork).families[0]!.backAssetId).toBe(withLongImage.families[0]!.backAssetId);
  const mutate = (fn: (d: CardDesigns) => void) => { const copy = structuredClone(designs); fn(copy); expect(() => parse(copy)).toThrow(); };
  mutate((d) => { d.cards[0]!.definitionId = "absent"; }); mutate((d) => { d.cards.push(d.cards[0]!); });
  mutate((d) => { d.decks[0]!.entityId = "status"; }); mutate((d) => { d.cards[0]!.familyId = "missing"; });
  mutate((d) => { d.assets[0]!.artwork.info.sha256 = "sha256:" + "0".repeat(64); });
  mutate((d) => { d.assets[0]!.artwork.info.width++; }); mutate((d) => { d.assets[0]!.artwork.dataUrl = "https://example.test/private.png"; });
  mutate((d) => { d.assets[0]!.artwork.dataUrl = "data:image/svg+xml;base64,PHN2Zz4="; });
  mutate((d) => { d.assets[0]!.purpose = "card-illustration"; }); mutate((d) => { d.cards[0]!.rulesText = "a".repeat(6001); });
  mutate((d) => { Object.assign(d.assets[0]!.artwork, { source: { name: "private-source.png" } }); });
  // A zero-copy authored definition is a valid front; do not require a physical entity.
  draft.bundle.definitions!.zero_copy = { label: "Zero copies" }; const zero = structuredClone(designs.cards[0]!); zero.definitionId = "zero_copy"; designs.cards.push(zero); expect(parse(designs).cards).toHaveLength(3);
});

test("card edits version presentation, preserve canonical replay/cover, round trip and undo; damaged images stay repairable and publication-blocking", () => {
  const { draft, designs } = fixture(), original = structuredClone(draft), store = new EditorStore(draft, { saveDraft: () => {} });
  expect(store.applySceneCommand("Printed cards", (d) => attachCardDesigns(d, designs))).toBe(true);
  const edited = store.getSnapshot().draft;
  expect(edited.bundle.initialSnapshot).toEqual(original.bundle.initialSnapshot); expect(edited.artwork).toEqual(original.artwork);
  expect(edited.bundle.integrity.manifestHash).not.toBe(original.bundle.integrity.manifestHash);
  expect(importBundleAsDraft(exportBundleText(edited), "export").bundle).toEqual(edited.bundle);
  expect(normalizeEditorDraft(JSON.parse(JSON.stringify(edited))).bundle).toEqual(edited.bundle);
  const projection = new KernelStore(); projection.loadRelease(edited.bundle); const hash = projection.getSnapshot().stateHash;
  projection.setCardDesignsBundle(null); expect(projection.getSnapshot().stateHash).toBe(hash);
  projection.setCardDesignsBundle(edited.bundle.files.find((f) => f.path === CARD_DESIGNS_PATH)!.content); expect(projection.getSnapshot().stateHash).toBe(hash);
  store.undo(); expect(store.getSnapshot().bundle).toEqual(original.bundle); store.redo(); expect(store.getSnapshot().bundle).toEqual(edited.bundle);
  const damaged = structuredClone(edited), file = damaged.bundle.files.find((f) => f.path === CARD_DESIGNS_PATH)!;
  const data = JSON.parse(file.content) as CardDesigns; data.assets[0]!.artwork.info.sha256 = "sha256:" + "0".repeat(64);
  file.content = JSON.stringify(data); file.contentHash = rawContentHash(file.content, sha256); file.byteLength = new TextEncoder().encode(file.content).length; rebuildDraftIntegrity(damaged);
  expect(prevalidateRelease(JSON.stringify(damaged.bundle), damaged.minPlayers, damaged.maxPlayers).report).toContainEqual(expect.objectContaining({ check: "card_designs", ok: false }));
  expect(normalizeEditorDraft(damaged).bundle).toEqual(damaged.bundle);
  expect(canResumeCardArtwork(damaged, { kind: "family-back", targetId: "a", brief: "A deliberately authored back" })).toBe(false);
  expect(canResumeCardArtwork(edited, { kind: "family-back", targetId: "a", brief: "A deliberately authored back" })).toBe(true);
  expect(compileDraftForPlaytest(damaged).initialSnapshot).toEqual(damaged.bundle.initialSnapshot);
  expect(readCardDesigns(file.content)?.assets).toHaveLength(1); // exactly one good image remains
  file.content += " "; expect(() => normalizeEditorDraft(damaged)).toThrow(); // no integrity auto-repair
  projection.dispose(); store.dispose();
});

test("private image briefs split from public printed data and owner hands get only their own designs", () => {
  const { designs, state, draft } = fixture();
  const plan = { version: 1, families: designs.families.map(({ backAssetId: _, ...f }) => ({ ...f, backBrief: "Private family image brief", illustrationBrief: "Shared landscape subject" })), cards: designs.cards.map((c) => ({ ...c, illustrationBrief: "" })), decks: designs.decks };
  const assembled = assembleCardDesignPlan(plan); expect(assembled.briefs).toHaveLength(4); expect(JSON.stringify(assembled.designs)).not.toContain("Private family image brief");
  const original = hashValue(state); const own = localHandItems(state, "no-seat", draft.bundle.definitions!, JSON.stringify(designs)); expect(own).toEqual([]); expect(hashValue(state)).toBe(original);
  expect(cardImageBytes(designs.assets[0]!, sha256).length).toBeGreaterThan(0);
});

test("private image briefs normalize surrounding whitespace without modifying complete printed rule text", () => {
  const { designs } = fixture();
  const rulesText = "  Preserve printed whitespace and the final rule.  ";
  const plan = { version: 1, families: [{ id: "a", label: "Authored", color: "#245b40", backBrief: "  Symmetric back brief  ", illustrationBrief: "   " }], cards: [{ ...designs.cards[0]!, familyId: "a", rulesText, illustrationBrief: "  One card subject  " }], decks: [] };
  const result = assembleCardDesignPlan(plan); expect(result.briefs.map((j) => j.brief)).toEqual(["Symmetric back brief", "One card subject"]); expect(result.designs.families[0]!.illustrated).toBe(false); expect(result.designs.cards[0]!.rulesText).toBe(rulesText);
});
