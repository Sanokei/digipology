import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { HandSortMode, HandStripItem } from "../pages/tableHandModel";
import { handPlayActions, sortHandItems } from "../pages/tableHandModel";
import type { TableActionSender } from "../scene/TableScene";
import { InspectOverlay } from "./InspectOverlay";
import { ObjectContextMenu } from "./ObjectContextMenu";

export type { HandStripItem } from "../pages/tableHandModel";

interface DragState {
  pointerId: number;
  item: HandStripItem;
  startX: number;
  startY: number;
  moved: boolean;
  longPressed: boolean;
}

function storageKey(roomId: string): string {
  return `digipology.handSort.${roomId}`;
}

function initialSort(roomId: string): HandSortMode {
  if (typeof sessionStorage === "undefined") return "none";
  try { return sessionStorage.getItem(storageKey(roomId)) === "label" ? "label" : "none"; }
  catch { return "none"; }
}

export function HandStrip({
  items,
  roomId = "default",
  client = null,
  interactionsPaused = false,
  projectToTable,
  onDragPlayed,
}: {
  items: readonly HandStripItem[];
  roomId?: string;
  client?: TableActionSender | null;
  interactionsPaused?: boolean;
  projectToTable?: (clientX: number, clientY: number) => { x: number; y: number; z: number } | null;
  onDragPlayed?: () => void;
}) {
  const [inspected, setInspected] = useState<HandStripItem | null>(null);
  const [sortMode, setSortMode] = useState<HandSortMode>(() => initialSort(roomId));
  const [menu, setMenu] = useState<{ item: HandStripItem; x: number; y: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const displayedItems = useMemo(() => sortHandItems(items, sortMode), [items, sortMode]);

  useEffect(() => {
    if (interactionsPaused) setMenu(null);
  }, [interactionsPaused]);

  const play = (item: HandStripItem, point: { x: number; y: number; z: number }) => {
    if (client === null || interactionsPaused) return;
    const [grab, drop] = handPlayActions(item, point);
    const grabbed = client.sendAction(grab);
    if (grabbed === null) return;
    client.sendAction(drop);
    onDragPlayed?.();
  };

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  return (
    <>
      <section className={`hand-strip${items.length === 0 ? " hand-strip--empty" : ""}`} aria-label="Your hand">
        <div className="hand-strip__heading"><span>Hand</span><em aria-label={`${items.length} cards`}>{items.length}</em></div>
        <label className="hand-strip__sort">Sort<select value={sortMode} onChange={(event) => {
          const next = event.currentTarget.value === "label" ? "label" : "none";
          setSortMode(next);
          try { sessionStorage.setItem(storageKey(roomId), next); } catch { /* Storage may be unavailable. */ }
        }}><option value="none">None</option><option value="label">By label</option></select></label>
        {items.length === 0
          ? <span className="hand-strip__empty">Your hand is empty</span>
          : <div className="hand-strip__cards">{displayedItems.map((item) => (
              <button
                key={item.entityId}
                type="button"
                className="hand-card"
                style={{ "--card-color": item.color } as CSSProperties}
                onClick={() => {
                  if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                  setInspected(item);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ item, x: event.clientX, y: event.clientY });
                }}
                onPointerDown={(event) => {
                  if (interactionsPaused || event.button !== 0) return;
                  clearTimer();
                  dragRef.current = { pointerId: event.pointerId, item, startX: event.clientX, startY: event.clientY, moved: false, longPressed: false };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  timerRef.current = setTimeout(() => {
                    const drag = dragRef.current;
                    if (drag === null || drag.moved) return;
                    drag.longPressed = true;
                    suppressClickRef.current = true;
                    setMenu({ item: drag.item, x: drag.startX, y: drag.startY });
                  }, 450);
                }}
                onPointerMove={(event) => {
                  const drag = dragRef.current;
                  if (drag === null || drag.pointerId !== event.pointerId) return;
                  if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
                    drag.moved = true;
                    clearTimer();
                  }
                }}
                onPointerUp={(event) => {
                  const drag = dragRef.current;
                  if (drag === null || drag.pointerId !== event.pointerId) return;
                  clearTimer();
                  dragRef.current = null;
                  if (drag.moved) {
                    suppressClickRef.current = true;
                    const point = projectToTable?.(event.clientX, event.clientY) ?? null;
                    if (point !== null) play(drag.item, point);
                  }
                }}
                onPointerCancel={() => { clearTimer(); dragRef.current = null; }}
                aria-label={`Inspect ${item.label}`}
              >
                <i aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}</div>}
      </section>
      {inspected === null ? null : <InspectOverlay item={{ ...inspected, kind: "card", hidden: false }} onDismiss={() => setInspected(null)} />}
      {menu === null ? null : <ObjectContextMenu
        x={menu.x}
        y={menu.y}
        label={menu.item.label}
        actions={[
          { id: "inspect", label: "Inspect", run: () => setInspected(menu.item) },
          { id: "play", label: "Play to table", disabled: interactionsPaused || client === null, run: () => play(menu.item, { x: 0, y: 0, z: 0 }) },
        ]}
        onDismiss={() => setMenu(null)}
      />}
    </>
  );
}
