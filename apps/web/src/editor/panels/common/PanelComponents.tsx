import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GripVertical, X } from "lucide-react";

export function PanelEmptyState({ children }: { children: ReactNode }) {
  return <div className="editor-empty-state">{children}</div>;
}

export function ComponentCard({
  title,
  onRemove,
  children,
}: { title: string; onRemove?: () => void; children: ReactNode }) {
  return <section className="editor-component-card">
    <header><strong>{title}</strong>{onRemove === undefined ? null : <button type="button" title={`Remove ${title}`} aria-label={`Remove ${title}`} onClick={onRemove}><X size={14} /></button>}</header>
    <div>{children}</div>
  </section>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="editor-field"><span>{label}</span>{children}</label>;
}

export function CommitTextInput({
  value,
  onCommit,
  multiline = false,
  placeholder,
}: { value: string; onCommit: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  if (multiline) {
    return <textarea value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); } }} />;
  }
  return <input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") { commit(); event.currentTarget.blur(); }
      if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); }
    }} />;
}

function clamp(value: number, min?: number, max?: number): number {
  let next = Math.round(value * 10_000) / 10_000;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

export function NumberInput({
  value,
  onCommit,
  onDragStart,
  onPreview,
  onDragEnd,
  label,
  min,
  max,
  step = 0.1,
  sensitivity = 0.02,
  style,
}: {
  value: number;
  onCommit: (value: number) => void;
  onDragStart?: () => void;
  onPreview?: (value: number) => void;
  onDragEnd?: () => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  sensitivity?: number;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState(String(value));
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => setDraft(String(value)), [value]);
  const commitDraft = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(String(valueRef.current)); return; }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== valueRef.current) onCommit(next);
  };
  return <div className="editor-number" style={style}>
    <button type="button" className="editor-number__scrub" aria-label={`Drag to adjust ${label ?? "value"}`}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startValue = valueRef.current;
        onDragStart?.();
        const move = (moveEvent: PointerEvent) => {
          const next = clamp(startValue + (moveEvent.clientX - startX) * sensitivity, min, max);
          setDraft(String(next));
          onPreview?.(next);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          onDragEnd?.();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}><GripVertical size={12} />{label}</button>
    <input type="number" value={draft} min={min} max={max} step={step} inputMode="decimal"
      onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") { commitDraft(); event.currentTarget.blur(); }
        else if (event.key === "Escape") { setDraft(String(valueRef.current)); event.currentTarget.blur(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const multiplier = event.shiftKey ? 10 : 1;
          onCommit(clamp(valueRef.current + (event.key === "ArrowUp" ? step : -step) * multiplier, min, max));
        }
      }} />
  </div>;
}

export function CommitColorInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  return <span className="editor-color-input"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
    onChange={(event) => onCommit(event.currentTarget.value)} /><CommitTextInput value={value} onCommit={onCommit} /></span>;
}
