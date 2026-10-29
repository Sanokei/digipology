import type { ArtworkCredits, ReadyDraftArtwork } from "digipology-protocol";
import { artworkBytes, normalizeDraftArtwork } from "../editor/state/artworkData";

export const CARD_BACK_PATH = "runtime/presentation/card-back.json";
export interface CardBackDefinition {
  readonly key: string;
  readonly title: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly credits?: ArtworkCredits;
  readonly issue?: string;
  readonly pending?: true;
}
const parsed = new Map<string, ReadyDraftArtwork>();

export function readCardBackArtwork(content: string): ReadyDraftArtwork {
  const cached = parsed.get(content);
  if (cached) return cached;
  if (content.length > 720_000) throw new Error("This card-back file is too large.");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("This card-back file could not be read."); }
  const raw = value as { kind?: unknown; version?: unknown; artwork?: unknown } | null;
  const artwork = raw?.kind === "digipology-card-back" && raw.version === 1 ? normalizeDraftArtwork(raw.artwork) : undefined;
  if (artwork?.status !== "ready") throw new Error("The saved card-back image is damaged. Replace it with a complete raster image.");
  // Back packages are public release assets; never retain a private upload filename.
  const clean: ReadyDraftArtwork = { status: "ready", info: artwork.info, dataUrl: artwork.dataUrl };
  if (parsed.size >= 6) parsed.delete(parsed.keys().next().value!);
  parsed.set(content, clean);
  return clean;
}

export function cardBackPackage(artwork: ReadyDraftArtwork): string {
  artworkBytes(artwork);
  const content = JSON.stringify({ kind: "digipology-card-back", version: 1, artwork: { status: "ready", info: artwork.info, dataUrl: artwork.dataUrl } }, null, 2);
  readCardBackArtwork(content);
  return content;
}

/** Public game branding only; this selection never sees a concealed card's identity. */
export function cardBackForGame(title: string | null, content?: string | null, releaseId?: string | null): CardBackDefinition {
  const name = title?.trim() || "Your game";
  let issue: string | undefined;
  if (content) {
    try {
      const art = readCardBackArtwork(content);
      return { key: art.info.sha256, title: name, src: art.dataUrl, width: art.info.width, height: art.info.height, credits: art.info.credits };
    } catch (error) { issue = error instanceof Error ? error.message : "The card-back image could not be read."; }
  }
  const known = [["builtin_first_deal_", "first-deal"], ["builtin_dice_dash_", "dice-dash"], ["builtin_zone_runner_", "zone-runner"]] as const;
  const art = known.find(([prefix]) => releaseId?.startsWith(prefix))?.[1];
  if (art) return { key: `builtin-back:${art}:1`, title: name, src: `/art/${art}.webp`, width: 1024, height: 1536, ...(issue ? { issue } : {}) };
  // An unrelated sample poster is not artwork created for this game.
  return { key: `pending-back:${name}`, title: name, src: "", width: 768, height: 1152, pending: true, ...(issue ? { issue } : {}) };
}
