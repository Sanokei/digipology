import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import type { GameRulebook } from "digipology-protocol";
import "./rulebook.css";

type Block = { kind: "heading"; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; ordered: boolean; items: string[] };

export function rulebookBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") }); paragraph = []; };
  const flushList = () => { if (list) blocks.push({ kind: "list", ...list }); list = null; };
  for (const raw of body.replaceAll("\r", "").split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const item = /^(?:(\d+)[.)]|[-*+])\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); blocks.push({ kind: "heading", text: heading[1]! }); }
    else if (item) {
      flushParagraph();
      const ordered = item[1] !== undefined;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[2]!);
    } else if (!line) { flushParagraph(); flushList(); }
    else { flushList(); paragraph.push(line); }
  }
  flushParagraph(); flushList();
  return blocks;
}

/** Keep keyboard focus within the reading surface, including recovery actions. */
export function ReadingDialog({ heading, eyebrow, closeLabel, bodyLabel, children, onClose, returnFocusTo }: {
  heading: string; eyebrow: string; closeLabel: string; bodyLabel: string; children: ReactNode; onClose(): void; returnFocusTo?: RefObject<HTMLElement>;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => (returnFocusTo?.current ?? previous)?.focus();
  }, [returnFocusTo]);
  return <div className="rulebook-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="rulebook-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "Tab") {
        const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
        const first = stops[0], last = stops.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><div><p>{eyebrow}</p><h2 id={headingId}>{heading}</h2></div><button ref={close} type="button" aria-label={closeLabel} onClick={onClose}>×</button></header>
      <div ref={body} className="rulebook-dialog__body" tabIndex={0} aria-label={bodyLabel}>{children}</div>
    </section>
  </div>;
}

export function RulebookDialog({ rulebook, title, onClose }: { rulebook: GameRulebook | null; title: string; onClose(): void }) {
  return <ReadingDialog heading={`How to play ${title}`} eyebrow="At a glance" closeLabel="Close rules" bodyLabel="Game rules" onClose={onClose}>{rulebook === null
        ? <p>No rulebook was included with this game. Ask the host which rules apply.</p>
        : rulebookBlocks(rulebook.body).map((block, index) => block.kind === "heading" ? <h3 key={index}>{block.text}</h3>
          : block.kind === "paragraph" ? <p key={index}>{block.text}</p>
          : block.ordered ? <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>
          : <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>)}</ReadingDialog>;
}
