import { useEffect, useMemo, useRef, useState } from "react";
import type { PieceArtwork } from "../scene/pieceArtwork";
import { drawPieceArtwork } from "../scene/pieceArtworkCanvas";
import "./playingCard.css";
import type { PlayingCardIdentity } from "./playingCardIdentity";
export type { PlayingCardIdentity } from "./playingCardIdentity";

type CardArtwork = Extract<PieceArtwork, { kind: "card-back" | "standard-card" | "custom-card" }>;

/** The hand, inspection view and physical table use the same raster face. */
function RasterCardFace({ artwork, fallback, compact = false }: { artwork: CardArtwork; fallback: string; compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx === null || ctx === undefined) { setPainted(false); return; }
    let active = true;
    const paint = () => {
      if (!active) return;
      try { drawPieceArtwork(ctx, 512, 736, artwork); setPainted(true); }
      catch { setPainted(false); }
    };
    paint();
    // Repaint once fonts settle, including a late first visit to the table.
    void document.fonts?.ready.then(paint);
    return () => { active = false; };
  }, [artwork]);
  return <span className={`playing-card${compact ? " playing-card--compact" : ""}`} aria-hidden="true" data-card-face={artwork.kind}>
    <canvas ref={canvasRef} width={512} height={736} hidden={!painted} />
    {painted ? null : <span className="playing-card__fallback">{fallback}</span>}
  </span>;
}

export function PlayingCardFace({ identity, compact = false }: { identity: PlayingCardIdentity; compact?: boolean }) {
  const artwork = useMemo<CardArtwork>(() => ({ kind: "standard-card", identity: { rank: identity.rank, suit: identity.suit } }), [identity.rank, identity.suit]);
  return <RasterCardFace artwork={artwork} fallback={`${identity.rank} ${identity.suit}`} compact={compact} />;
}

export function CustomCardFace({ label, color, compact = false }: { label: string; color: string; compact?: boolean }) {
  const artwork = useMemo<CardArtwork>(() => ({ kind: "custom-card", label, accent: color }), [label, color]);
  return <RasterCardFace artwork={artwork} fallback={label} compact={compact} />;
}

/** No definition, label or face data reaches a concealed card's painter. */
export function PlayingCardBack() {
  const artwork = useMemo<CardArtwork>(() => ({ kind: "card-back" }), []);
  return <RasterCardFace artwork={artwork} fallback="Face-down card" />;
}
