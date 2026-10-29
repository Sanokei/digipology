import { hashValue, sha256 } from "digipology-canonical-json";
import { CARD_DESIGNS_PATH, parseCardDesigns, type CardDesigns } from "digipology-protocol";
import { rawContentHash, UPLOAD_BODY_LIMIT } from "digipology-protocol/http";
import type { CanonicalGameState } from "digipology-kernel";
import type { EditorDraft } from "./types";
import { rebuildDraftIntegrity } from "./bundle";

export function attachCardDesigns(draft: EditorDraft, designs: CardDesigns): void {
  const content = JSON.stringify(designs);
  parseCardDesigns(content, sha256, { definitions: draft.bundle.definitions ?? {}, entities: (draft.bundle.initialSnapshot.state as CanonicalGameState).entities });
  const file = { path: CARD_DESIGNS_PATH, content, byteLength: new TextEncoder().encode(content).length, contentHash: rawContentHash(content, sha256) };
  const files = [...draft.bundle.files.filter((f) => f.path !== CARD_DESIGNS_PATH), file];
  if (files.length > 256 || new TextEncoder().encode(JSON.stringify({ bundle: { ...draft.bundle, files } })).length > UPLOAD_BODY_LIMIT) throw new Error("These card images exceed the 1 MiB game budget. Keep smaller images or share family illustrations. Your game is preserved.");
  draft.bundle.files = files; rebuildDraftIntegrity(draft);
}
export function emptyCardDesigns(draft: EditorDraft): CardDesigns {
  const entities = Object.values((draft.bundle.initialSnapshot.state as CanonicalGameState).entities);
  const decks = entities.filter((entity) => entity.components.deck);
  const families = (decks.length ? decks : [{ id: "cards" }]).map((deck, i) => ({ id: `family-${i + 1}`, label: decks.length > 1 ? `Deck ${i + 1}` : "Cards", color: "#27685b", illustrated: true }));
  const ids = [...new Set(entities.flatMap((entity) => entity.components.card ? [entity.components.card.definitionId] : []))];
  return { kind: "digipology-card-designs", version: 1, families, assets: [], decks: decks.map((deck, i) => ({ entityId: deck.id, familyId: families[i]!.id })), cards: ids.map((definitionId) => {
    const deckIndex = decks.findIndex((deck) => deck.components.container?.items.some((id) => entities.find((e) => e.id === id)?.components.card?.definitionId === definitionId));
    return { definitionId, familyId: families[Math.max(0, deckIndex)]!.id, title: draft.bundle.definitions?.[definitionId]?.label || definitionId, typeLine: "", cost: "", condition: "", rulesText: "", flavor: "", fields: [] };
  }) };
}

export function withCardImage(designs: CardDesigns, target: { kind: import("digipology-protocol").CardArtTarget; targetId: string }, artwork?: import("digipology-protocol").ReadyDraftArtwork): CardDesigns {
  const next = structuredClone(designs), { kind, targetId } = target;
  const item = kind === "card-illustration" ? next.cards.find((c) => c.definitionId === targetId) : next.families.find((f) => f.id === targetId);
  if (!item) throw new Error("This card or family no longer exists.");
  const key = kind === "family-back" ? "backAssetId" : "illustrationAssetId";
  const readableId = `image-${kind}-${targetId}`;
  // Target IDs may themselves fill the protocol's 128-character allowance.
  const id = readableId.length <= 128 ? readableId : `image-${kind}-${hashValue([kind, targetId]).slice(7)}`;
  if (artwork) {
    Object.assign(item, { [key]: id });
    if (kind === "family-illustration") Object.assign(item, { illustrated: true });
    next.assets = [...next.assets.filter((asset) => asset.id !== id), { id, purpose: kind === "family-back" ? "card-back" : "card-illustration", artwork: { status: "ready", info: artwork.info, dataUrl: artwork.dataUrl }, ...(artwork.source?.sha256 && artwork.source.recipe ? { original: { sha256: artwork.source.sha256, width: artwork.source.width, height: artwork.source.height, bytes: artwork.source.bytes, recipe: artwork.source.recipe } } : {}) }];
  } else delete (item as unknown as Record<string, unknown>)[key];
  const used = new Set([...next.families.flatMap((f) => [f.backAssetId, f.illustrationAssetId]), ...next.cards.map((c) => c.illustrationAssetId)]);
  next.assets = next.assets.filter((asset) => used.has(asset.id)); return next;
}
export function selectedCardImage(designs: CardDesigns | null, target: { kind: import("digipology-protocol").CardArtTarget; targetId: string }) {
  const item = target.kind === "card-illustration" ? designs?.cards.find((c) => c.definitionId === target.targetId) : designs?.families.find((f) => f.id === target.targetId);
  const id = target.kind === "family-back" ? (item as import("digipology-protocol").CardFamily | undefined)?.backAssetId : item?.illustrationAssetId;
  return designs?.assets.find((a) => a.id === id)?.artwork;
}
