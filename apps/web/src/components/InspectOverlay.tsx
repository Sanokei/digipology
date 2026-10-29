import type { DesignedCard } from "../scene/cardDesigns";
import { useEffect, useRef, type CSSProperties } from "react";
import { DesignedCardFace, CustomCardFace, PlayingCardBack, PlayingCardFace, type PlayingCardIdentity } from "./PlayingCardFace";
import type { CardBackDefinition } from "../scene/cardBack";

export interface InspectOverlayItem {
  entityId: string;
  label: string;
  color: string;
  kind: "card" | "deck" | "token";
  hidden?: boolean;
  heldBy?: string | null;
  face?: PlayingCardIdentity;
  design?: DesignedCard;
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
      aria-label={`Inspecting ${item.hidden ? "Face-down card" : item.label}`}
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
      <div className="inspect-overlay__toolbar"><button className="inspect-overlay__close" type="button" onClick={onDismiss} aria-label="Close inspect">×</button></div>
      <div
        className={`inspect-overlay__preview inspect-overlay__preview--${item.kind}${item.hidden ? " inspect-overlay__preview--back" : ""}`}
        style={item.hidden ? undefined : { "--inspect-color": item.color } as CSSProperties}
        aria-label={item.kind === "deck" ? "Deck back" : item.hidden ? "Face-down card back" : item.label}
      >
        {item.kind === "token" ? <span>{item.label}</span> : item.hidden || item.kind === "deck" ? <PlayingCardBack {...(cardBack ? { definition: cardBack } : {})} /> : item.design ? <DesignedCardFace design={item.design} /> : item.face !== undefined ? <PlayingCardFace identity={item.face} /> : <CustomCardFace label={item.label} color={item.color} />}
      </div>
      <strong>{item.kind === "deck" ? item.label : item.hidden ? "Face-down card" : item.label}</strong>
      <small>{item.kind === "deck" ? "Deck" : item.kind === "card" ? "Card" : "Table object"}</small>
      {(item.hidden || item.kind === "deck") && cardBack?.credits ? <div className="inspect-card-credits"><small>Card-back artwork · {cardBack.credits.artist || "Creator supplied"} · {cardBack.credits.license || "See source"}</small>{cardBack.credits.sourceUrl ? <a href={cardBack.credits.sourceUrl} target="_blank" rel="noreferrer">Artwork source</a> : null}<a href={cardBack.src} download={`card-back.${cardBack.src.startsWith("data:image/png") ? "png" : cardBack.src.startsWith("data:image/jpeg") ? "jpg" : "webp"}`}>Download card-back image</a></div> : null}
      {!item.hidden && item.kind === "card" && item.design ? <section className="inspect-card-rules" aria-label="Full card rules" tabIndex={0}>
        <p>{item.design.card.typeLine}</p>
        <dl>{item.design.card.cost ? <><dt>Cost / ingredients</dt><dd>{item.design.card.cost}</dd></> : null}{item.design.card.condition ? <><dt>Condition</dt><dd>{item.design.card.condition}</dd></> : null}<dt>Effect</dt><dd>{item.design.card.rulesText || "No printed effect."}</dd>{item.design.card.fields.map((field, i) => <div key={i}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
        {item.design.card.flavor ? <p><em>{item.design.card.flavor}</em></p> : null}
        {item.design.illustration?.credits ? <p>Illustration · {item.design.illustration.credits.artist || "Creator supplied"} · {item.design.illustration.credits.license || "See source"}{item.design.illustration.credits.sourceUrl ? <> · <a href={item.design.illustration.credits.sourceUrl} target="_blank" rel="noreferrer">Artwork source</a></> : null} · <a href={item.design.illustration.src} download={`card-illustration.${item.design.illustration.src.startsWith("data:image/png") ? "png" : item.design.illustration.src.startsWith("data:image/jpeg") ? "jpg" : "webp"}`}>Download illustration</a></p> : null}
      </section> : null}
      {item.heldBy === null || item.heldBy === undefined ? null : <p>Held by {item.heldBy}</p>}
    </article>
  </div>;
}
