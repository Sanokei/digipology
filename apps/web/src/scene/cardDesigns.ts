import { sha256 } from "digipology-canonical-json";
import { cardImageBytes, parseCardDesigns, type CardDesigns, type CardDesignAsset, type CardDesign, type CardFamily } from "digipology-protocol";
import type { EntityRecord } from "digipology-kernel";
import type { CardBackDefinition } from "./cardBack";
export interface DesignedCard { card: CardDesign; family: CardFamily; illustration?: CardBackDefinition }
const cache = new Map<string, CardDesigns | null>();
/** Never render a damaged image. Metadata remains editable through the repair reader. */
export function readCardDesigns(content?: string | null): CardDesigns | null {
  if (!content) return null;
  if (cache.has(content)) return cache.get(content)!;
  let result: CardDesigns | null = null;
  try {
    result = parseCardDesigns(content);
    result = { ...result, assets: result.assets.filter((asset) => { try { cardImageBytes(asset, sha256); return true; } catch { return false; } }) };
  } catch { /* Bad metadata is reported by the editor and publication validation. */ }
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(content, result); return result;
}
export function cardAssetImage(asset: CardDesignAsset, title: string): CardBackDefinition {
  const { artwork: a } = asset;
  return { key: a.info.sha256, title, src: a.dataUrl, width: a.info.width, height: a.info.height, credits: a.info.credits };
}
export function designedCard(designs: CardDesigns | null, definitionId?: string): DesignedCard | undefined {
  const card = designs?.cards.find((item) => item.definitionId === definitionId);
  const family = designs?.families.find((item) => item.id === card?.familyId);
  if (!card || !family) return undefined;
  const asset = designs?.assets.find((item) => item.id === (card.illustrationAssetId ?? (family.illustrated === false ? undefined : family.illustrationAssetId)));
  return { card, family, ...(asset ? { illustration: cardAssetImage(asset, card.title) } : {}) };
}
/** Only a public family back crosses this boundary, never a front/label/illustration. */
export function entityCardBack(designs: CardDesigns | null, entity: EntityRecord, entities: Readonly<Record<string, EntityRecord>>, fallback: CardBackDefinition): CardBackDefinition {
  const topId = entity.components.deck ? entity.components.container?.items.at(-1) : undefined;
  const definitionId = topId ? entities[topId]?.components.card?.definitionId : entity.components.card?.definitionId;
  const card = designs?.cards.find((item) => item.definitionId === definitionId);
  // An unknown top card must not acquire the containing deck's family.
  const familyId = card?.familyId ?? (entity.components.deck && !topId ? designs?.decks.find((item) => item.entityId === entity.id)?.familyId : undefined);
  const family = designs?.families.find((item) => item.id === familyId);
  const asset = designs?.assets.find((item) => item.id === family?.backAssetId);
  return asset && family ? cardAssetImage(asset, family.label) : fallback;
}
