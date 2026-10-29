import { normalizeArtworkCredits, type ReadyDraftArtwork } from "./artwork";
import { normalizeArtworkGenerationProvenance } from "./art-generation";
import { inspectRasterImage } from "./raster";
import { soundHash } from "./sound-bundle";

export const CARD_DESIGNS_PATH = "runtime/presentation/cards.json";
export const CARD_DESIGNS_LIMIT = 850 * 1024;
export interface CardFamily { id: string; label: string; color: string; illustrated?: boolean; backAssetId?: string; illustrationAssetId?: string }
export interface CardDesign {
  definitionId: string; familyId: string; title: string; typeLine: string; cost: string;
  condition: string; rulesText: string; flavor: string; fields: Array<{ label: string; value: string }>;
  illustrationAssetId?: string;
}
export interface CardDesignAsset { id: string; purpose: "card-back" | "card-illustration"; artwork: ReadyDraftArtwork; original?: { sha256: string; width: number; height: number; bytes: number; recipe: string } }
export interface CardDesigns {
  kind: "digipology-card-designs"; version: 1; families: CardFamily[]; cards: CardDesign[];
  decks: Array<{ entityId: string; familyId: string }>; assets: CardDesignAsset[];
}
export interface CardDesignBindings {
  definitions?: Readonly<Record<string, unknown>>;
  entities: Readonly<Record<string, { components: { deck?: unknown } }>>;
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Unrecognized card-design fields.");
}
function text(value: unknown, max: number, required = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Card text must fit ${max} characters.`);
}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) throw new Error("Use a stable card, family or asset ID.");
}
function list(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Card-design list exceeds ${max} entries.`);
}
/** No DOM or tolerant decoder. Decode again before publication in the official client. */
export function cardImageBytes(asset: CardDesignAsset, digest: (bytes: Uint8Array) => Uint8Array): Uint8Array {
  const { artwork } = asset;
  const info = artwork.info;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(artwork.dataUrl);
  if (!match || match[1] !== info.contentType || match[2]!.length % 4 || match[2]!.length > 360_000) throw new Error("Card images must embed a complete PNG, JPEG or WebP smaller than 256 KiB.");
  const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", value = match[2]!;
  const bytes = new Uint8Array(value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const packed = base64.indexOf(value[i]!) * 262144 + base64.indexOf(value[i + 1]!) * 4096 + Math.max(0, base64.indexOf(value[i + 2]!)) * 64 + Math.max(0, base64.indexOf(value[i + 3]!));
    if (offset < bytes.length) bytes[offset++] = packed >>> 16;
    if (offset < bytes.length) bytes[offset++] = packed >>> 8 & 255;
    if (offset < bytes.length) bytes[offset++] = packed & 255;
  }
  const header = inspectRasterImage(bytes);
  if (bytes.length > 256 * 1024 || !header || header.contentType !== info.contentType || header.width !== info.width || header.height !== info.height || soundHash(bytes, digest) !== info.sha256) throw new Error(`The ${asset.id} image is incomplete or changed. Replace or remove it before publishing.`);
  return bytes;
}
/** Metadata-only parsing is exclusively for repair; never pass its images to a renderer. */
export function parseCardDesigns(content: string, digest?: (bytes: Uint8Array) => Uint8Array, bindings?: CardDesignBindings): CardDesigns {
  if (new TextEncoder().encode(content).length > CARD_DESIGNS_LIMIT) throw new Error("Card designs exceed the game artwork budget.");
  const value: unknown = JSON.parse(content);
  exact(value, ["kind", "version", "families", "cards", "decks", "assets"]);
  if (value.kind !== "digipology-card-designs" || value.version !== 1) throw new Error("Unsupported card-design version.");
  list(value.families, 32); list(value.cards, 256); list(value.decks, 64); list(value.assets, 64);
  const families = new Set<string>(), cards = new Set<string>(), decks = new Set<string>(), assets = new Map<string, string>();
  for (const family of value.families) {
    exact(family, ["id", "label", "color", "illustrated", "backAssetId", "illustrationAssetId"]); id(family.id); text(family.label, 80, true);
    if (families.has(family.id) || typeof family.color !== "string" || !/^#[a-f0-9]{6}$/i.test(family.color)) throw new Error("Each card family needs a unique ID and six-digit color.");
    if (family.illustrated !== undefined && typeof family.illustrated !== "boolean") throw new Error("Use a boolean illustrated-front choice.");
    families.add(family.id);
  }
  for (const asset of value.assets) {
    exact(asset, ["id", "purpose", "artwork", "original"]); id(asset.id);
    if (assets.has(asset.id) || !["card-back", "card-illustration"].includes(String(asset.purpose))) throw new Error("Each card image needs a unique ID and purpose.");
    exact(asset.artwork, ["status", "info", "dataUrl"]);
    exact(asset.artwork.info, ["formatVersion", "contentType", "width", "height", "sha256", "credits", "generation"]);
    const a = asset.artwork, info = a.info as Record<string, unknown>;
    if (a.status !== "ready" || typeof a.dataUrl !== "string" || a.dataUrl.length > 360_128 || info.formatVersion !== 1 || !["image/png", "image/jpeg", "image/webp"].includes(String(info.contentType)) || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || (info.width as number) < 1 || (info.height as number) < 1 || (info.width as number) > 4096 || (info.height as number) > 4096 || typeof info.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(info.sha256) || !normalizeArtworkCredits(info.credits) || (info.generation !== undefined && !normalizeArtworkGenerationProvenance(info.generation))) throw new Error("Invalid card-image information.");
    if (asset.purpose === "card-back" ? (info.width as number) * 3 !== (info.height as number) * 2 : (info.width as number) * 2 !== (info.height as number) * 3) throw new Error("Use portrait 2:3 backs and landscape 3:2 card illustrations.");
    if (asset.original !== undefined) {
      exact(asset.original, ["sha256", "width", "height", "bytes", "recipe"]);
      const original = asset.original;
      if (typeof original.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(original.sha256) || !Number.isSafeInteger(original.width) || !Number.isSafeInteger(original.height) || !Number.isSafeInteger(original.bytes) || (original.width as number) < 1 || (original.height as number) < 1 || (original.width as number) > 8192 || (original.height as number) > 8192 || (original.bytes as number) < 1 || (original.bytes as number) > 8 * 1024 * 1024) throw new Error("Keep the original card-image hash and bounded dimensions.");
      text(original.recipe, 1000, true);
    }
    if (digest) cardImageBytes(asset as unknown as CardDesignAsset, digest);
    assets.set(asset.id, asset.purpose as string);
  }
  const reference = (asset: unknown, purpose: string) => { if (asset !== undefined) { id(asset); if (assets.get(asset) !== purpose) throw new Error(`Missing ${purpose} image ${asset}.`); } };
  for (const family of value.families as unknown as CardFamily[]) { reference(family.backAssetId, "card-back"); reference(family.illustrationAssetId, "card-illustration"); }
  for (const card of value.cards) {
    exact(card, ["definitionId", "familyId", "title", "typeLine", "cost", "condition", "rulesText", "flavor", "fields", "illustrationAssetId"]);
    id(card.definitionId); id(card.familyId);
    if (cards.has(card.definitionId) || !families.has(card.familyId) || (bindings && !Object.hasOwn(bindings.definitions ?? {}, card.definitionId))) throw new Error(`Unknown or duplicate card binding ${card.definitionId}.`);
    cards.add(card.definitionId); text(card.title, 120, true); text(card.typeLine, 120); text(card.cost, 200); text(card.condition, 600); text(card.rulesText, 6000); text(card.flavor, 1000); list(card.fields, 8);
    for (const field of card.fields) { exact(field, ["label", "value"]); text(field.label, 80, true); text(field.value, 600); }
    reference(card.illustrationAssetId, "card-illustration");
  }
  for (const deck of value.decks) {
    exact(deck, ["entityId", "familyId"]); id(deck.entityId); id(deck.familyId);
    if (decks.has(deck.entityId) || !families.has(deck.familyId) || (bindings && !bindings.entities[deck.entityId]?.components.deck)) throw new Error(`Unknown or duplicate deck binding ${deck.entityId}.`);
    decks.add(deck.entityId);
  }
  return value as unknown as CardDesigns;
}

export type CardArtTarget = "family-back" | "family-illustration" | "card-illustration";
export interface CardArtBrief { kind: CardArtTarget; targetId: string; brief: string }
export interface CardDesignPlan {
  version: 1;
  families: Array<Pick<CardFamily, "id" | "label" | "color"> & { backBrief: string; illustrationBrief: string }>;
  cards: Array<Omit<CardDesign, "illustrationAssetId"> & { illustrationBrief: string }>;
  decks: CardDesigns["decks"];
}
/** Split private briefs from the public versioned presentation document. */
export function assembleCardDesignPlan(value: unknown): { designs: CardDesigns; briefs: CardArtBrief[] } {
  exact(value, ["version", "families", "cards", "decks"]);
  if (value.version !== 1) throw new Error("Unsupported printed card plan.");
  list(value.families, 32); list(value.cards, 256); list(value.decks, 64);
  const briefs: CardArtBrief[] = [];
  const families = value.families.map((raw) => {
    exact(raw, ["id", "label", "color", "backBrief", "illustrationBrief"]);
    text(raw.backBrief, 2000, true); text(raw.illustrationBrief, 2000);
    briefs.push({ kind: "family-back", targetId: String(raw.id), brief: raw.backBrief.trim() });
    if (raw.illustrationBrief.trim()) briefs.push({ kind: "family-illustration", targetId: String(raw.id), brief: raw.illustrationBrief.trim() });
    return { id: raw.id, label: raw.label, color: raw.color, illustrated: !!raw.illustrationBrief.trim() };
  });
  const cards = value.cards.map((raw) => {
    exact(raw, ["definitionId", "familyId", "title", "typeLine", "cost", "condition", "rulesText", "flavor", "fields", "illustrationBrief"]);
    text(raw.illustrationBrief, 2000);
    if (raw.illustrationBrief.trim()) briefs.push({ kind: "card-illustration", targetId: String(raw.definitionId), brief: raw.illustrationBrief.trim() });
    const { illustrationBrief: _private, ...card } = raw; return card;
  });
  if (briefs.length > 64) throw new Error("Use at most 64 scoped image briefs. Share family illustrations for large card catalogs.");
  const designs = parseCardDesigns(JSON.stringify({ kind: "digipology-card-designs", version: 1, families, cards, decks: value.decks, assets: [] }));
  return { designs, briefs };
}

/** Preserve selected immutable images by explicit stable target on model edits. */
export function preserveCardDesignAssets(next: CardDesigns, prior: CardDesigns | null): CardDesigns {
  if (!prior) return next;
  const result = structuredClone(next);
  for (const f of result.families) {
    const old = prior.families.find((item) => item.id === f.id);
    if (old?.backAssetId) f.backAssetId = old.backAssetId;
    if (old?.illustrationAssetId) f.illustrationAssetId = old.illustrationAssetId;
  }
  for (const c of result.cards) { const old = prior.cards.find((item) => item.definitionId === c.definitionId); if (old?.illustrationAssetId) c.illustrationAssetId = old.illustrationAssetId; }
  const used = new Set([...result.families.flatMap((f) => [f.backAssetId, f.illustrationAssetId]), ...result.cards.map((c) => c.illustrationAssetId)]);
  result.assets = structuredClone(prior.assets.filter((asset) => used.has(asset.id))); return result;
}
