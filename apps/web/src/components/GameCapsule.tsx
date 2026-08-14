import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";

import { gameCoverUrl, gameMetrics, type CatalogGameSummaryDto } from "../api/quickplayAdapter";
import { formatCompactCount } from "../utils/compactCount";
import { coverPlaceholder } from "../utils/coverPlaceholder";
import { capsuleKeyboardAction, createHoverIntentModel, type HoverIntentModel } from "./capsuleModel";

interface GameCapsuleProps {
  game: CatalogGameSummaryDto;
  pending: boolean;
  onQuickPlay(game: CatalogGameSummaryDto): void;
  onHost(game: CatalogGameSummaryDto): void;
  onDetails(game: CatalogGameSummaryDto): void;
}

export function GameCapsule({ game, pending, onQuickPlay, onHost, onDetails }: GameCapsuleProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const hoverIntent = useRef<HoverIntentModel | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = gameCoverUrl(game);
  const metrics = gameMetrics(game);
  const placeholder = coverPlaceholder(game.slug);
  const plays = `${formatCompactCount(metrics.totalPlays)} plays`;
  const accessibleCounts = `${metrics.currentPlayers > 0 ? `${metrics.currentPlayers} playing` : "no active players"}, ${plays}`;

  useEffect(() => {
    setCoverFailed(false);
  }, [coverUrl]);

  useEffect(() => {
    hoverIntent.current = createHoverIntentModel(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle as number),
      () => setActionsVisible(true),
    );
    return () => hoverIntent.current?.dispose();
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sheetOpen]);

  function pointerEnter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse") hoverIntent.current?.enter();
  }

  function pointerLeave() {
    hoverIntent.current?.leave();
    if (!rootRef.current?.contains(document.activeElement)) setActionsVisible(false);
  }

  function focus(event: FocusEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.target)) setActionsVisible(true);
  }

  function blur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setActionsVisible(false);
  }

  const quickPlay = () => {
    if (!pending) onQuickPlay(game);
  };

  return (
    <article
      className={`game-capsule${actionsVisible ? " game-capsule--actions" : ""}${pending ? " game-capsule--pending" : ""}`}
      ref={rootRef}
      onPointerEnter={pointerEnter}
      onPointerLeave={pointerLeave}
      onFocusCapture={focus}
      onBlurCapture={blur}
    >
      <button
        type="button"
        className="game-capsule__button"
        aria-label={`Quick play ${game.title}. ${accessibleCounts}.`}
        aria-busy={pending}
        aria-disabled={pending}
        onClick={quickPlay}
        onKeyDown={(event) => {
          if (capsuleKeyboardAction(event.key) !== "quickplay") return;
          event.preventDefault();
          quickPlay();
        }}
      >
        <span className="game-capsule__poster" style={coverUrl && !coverFailed ? undefined : { background: placeholder.background }}>
          {coverUrl && !coverFailed ? (
            <img
              src={coverUrl}
              alt=""
              width={336}
              height={504}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setCoverFailed(true)}
            />
          ) : <span className="game-capsule__fallback-title">{game.title}</span>}
          <span className="game-capsule__badge-slot">
            {metrics.currentPlayers > 0 ? (
              <span className="game-capsule__live"><span aria-hidden="true" />{formatCompactCount(metrics.currentPlayers)} playing</span>
            ) : null}
          </span>
          {pending ? <span className="game-capsule__loading">Finding a table…</span> : null}
        </span>
        <span className="game-capsule__meta">
          <span className="game-capsule__title">{game.title}</span>
          <span className="game-capsule__metrics" aria-hidden="true">{plays}</span>
          <span className="game-capsule__desc">{game.tagline || `${game.minPlayers}–${game.maxPlayers} players`}</span>
        </span>
      </button>

      {actionsVisible && !pending ? (
        <div className="game-capsule__quick-actions" aria-label={`Actions for ${game.title}`}>
          <button type="button" className="game-capsule__quick-primary" onClick={quickPlay}>Quick Play</button>
          <button type="button" onClick={() => onHost(game)}>Host a Room</button>
          <button type="button" className="game-capsule__info" aria-label={`Details for ${game.title}`} onClick={() => onDetails(game)}>i</button>
        </div>
      ) : null}

      <button
        type="button"
        className="game-capsule__more"
        aria-label={`More actions for ${game.title}`}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {sheetOpen ? (
        <div className="capsule-sheet-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSheetOpen(false);
        }}>
          <section className="capsule-sheet" role="dialog" aria-modal="true" aria-label={`Actions for ${game.title}`}>
            <strong>{game.title}</strong>
            <button type="button" onClick={() => { setSheetOpen(false); onHost(game); }}>Host a Room</button>
            <button type="button" onClick={() => { setSheetOpen(false); onDetails(game); }}>View Details</button>
            <button type="button" className="capsule-sheet__cancel" onClick={() => setSheetOpen(false)}>Cancel</button>
          </section>
        </div>
      ) : null}
    </article>
  );
}
