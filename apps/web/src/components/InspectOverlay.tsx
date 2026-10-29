import { useEffect, useRef, type CSSProperties } from "react";
import { CustomCardFace, PlayingCardBack, PlayingCardFace, type PlayingCardIdentity } from "./PlayingCardFace";
import type { CardBackDefinition } from "../scene/cardBack";

export interface InspectOverlayItem {
  entityId: string;
  label: string;
  color: string;
  kind: "card" | "deck" | "token";
  hidden?: boolean;
  heldBy?: string | null;
  face?: PlayingCardIdentity;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.hasAttribute("disabled"));
}

export function InspectOverlay({ item, onDismiss, cardBack }: { item: InspectOverlayItem; onDismiss(): void; cardBack?: CardBackDefinition }) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  return <div className="inspect-overlay" role="presentation" onPointerDown={onDismiss}>
    <article
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Inspecting ${item.label}`}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
          return;
        }
        if (event.key !== "Tab" || dialogRef.current === null) return;
        const focusable = focusableElements(dialogRef.current);
        if (focusable.length === 0) return;
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (current <= 0 ? focusable.length - 1 : current - 1)
          : (current >= focusable.length - 1 ? 0 : current + 1);
        event.preventDefault();
        focusable[next]?.focus();
      }}
    >
      <button className="inspect-overlay__close" type="button" onClick={onDismiss} aria-label="Close inspect">×</button>
      <div
        className={`inspect-overlay__preview inspect-overlay__preview--${item.kind}${item.hidden ? " inspect-overlay__preview--back" : ""}`}
        style={item.hidden ? undefined : { "--inspect-color": item.color } as CSSProperties}
        aria-label={item.kind === "deck" ? "Deck back" : item.hidden ? "Face-down card back" : item.label}
      >
        {item.kind === "token" ? <span>{item.label}</span> : item.hidden || item.kind === "deck" ? <PlayingCardBack {...(cardBack ? { definition: cardBack } : {})} /> : item.face !== undefined ? <PlayingCardFace identity={item.face} /> : <CustomCardFace label={item.label} color={item.color} />}
      </div>
      <strong>{item.kind === "deck" ? item.label : item.hidden ? "Face-down card" : item.label}</strong>
      <small>{item.kind === "deck" ? "Deck" : item.kind === "card" ? "Card" : "Table object"}</small>
      {(item.hidden || item.kind === "deck") && cardBack?.credits ? <div className="inspect-card-credits"><small>Card-back artwork · {cardBack.credits.artist || "Creator supplied"} · {cardBack.credits.license || "See source"}</small>{cardBack.credits.sourceUrl ? <a href={cardBack.credits.sourceUrl} target="_blank" rel="noreferrer">Artwork source</a> : null}<a href={cardBack.src} download={`card-back.${cardBack.src.startsWith("data:image/png") ? "png" : cardBack.src.startsWith("data:image/jpeg") ? "jpg" : "webp"}`}>Download card-back image</a></div> : null}
      {item.heldBy === null || item.heldBy === undefined ? null : <p>Held by {item.heldBy}</p>}
    </article>
  </div>;
}
