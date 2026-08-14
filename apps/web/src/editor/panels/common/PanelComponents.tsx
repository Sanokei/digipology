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

export function completeTextDraft(
  draft: string,
  value: string,
  onCommit: (value: string) => void,
  onComplete: () => void = () => undefined,
): void {
  if (draft !== value) onCommit(draft);
  onComplete();
}

export function CommitTextInput({
  value,
  onCommit,
  onComplete,
  onCancel,
  multiline = false,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  onComplete?: () => void;
  onCancel?: () => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const completedRef = useRef(false);
  draftRef.current = draft;
  valueRef.current = value;
  useEffect(() => {
    setDraft(value);
    draftRef.current = value;
    completedRef.current = false;
  }, [value]);
  const commit = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    completeTextDraft(draftRef.current, valueRef.current, onCommit, onComplete);
  };
  const change = (next: string) => {
    completedRef.current = false;
    draftRef.current = next;
    setDraft(next);
  };
  const cancel = (element: HTMLInputElement | HTMLTextAreaElement) => {
    completedRef.current = true;
    draftRef.current = valueRef.current;
    setDraft(valueRef.current);
    onCancel?.();
    element.blur();
  };
  if (multiline) {
    return <textarea value={draft} placeholder={placeholder} onFocus={() => { completedRef.current = false; }} onChange={(event) => change(event.currentTarget.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Escape") cancel(event.currentTarget); }} />;
  }
  return <input value={draft} placeholder={placeholder} onFocus={() => { completedRef.current = false; }} onChange={(event) => change(event.currentTarget.value)} onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") { commit(); event.currentTarget.blur(); }
      if (event.key === "Escape") cancel(event.currentTarget);
    }} />;
}

export const NUMBER_INPUT_ARROW_DEBOUNCE_MS = 400;

export interface NumberInputArrowBurst {
  step(value: number): void;
  finish(): void;
}

export function createNumberInputArrowBurst({
  onStart,
  onStep,
  onEnd,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (handle) => clearTimeout(handle),
}: {
  onStart: () => void;
  onStep: (value: number) => void;
  onEnd: () => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}): NumberInputArrowBurst {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!active) return;
    active = false;
    onEnd();
  };
  return {
    step(value) {
      if (!active) {
        active = true;
        onStart();
      }
      onStep(value);
      if (timer !== null) clearTimer(timer);
      timer = setTimer(finish, NUMBER_INPUT_ARROW_DEBOUNCE_MS);
    },
    finish,
  };
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
  const arrowValueRef = useRef(value);
  const arrowAdjustingRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const callbacksRef = useRef({ onDragStart, onPreview, onDragEnd, onCommit });
  callbacksRef.current = { onDragStart, onPreview, onDragEnd, onCommit };
  const arrowBurstRef = useRef<NumberInputArrowBurst | null>(null);
  if (arrowBurstRef.current === null) {
    arrowBurstRef.current = createNumberInputArrowBurst({
      onStart: () => {
        arrowAdjustingRef.current = true;
        callbacksRef.current.onDragStart?.();
      },
      onStep: (next) => {
        if (callbacksRef.current.onPreview === undefined) callbacksRef.current.onCommit(next);
        else callbacksRef.current.onPreview(next);
      },
      onEnd: () => {
        arrowAdjustingRef.current = false;
        callbacksRef.current.onDragEnd?.();
      },
    });
  }
  valueRef.current = value;
  useEffect(() => {
    arrowValueRef.current = value;
    setDraft(String(value));
  }, [value]);
  useEffect(() => () => arrowBurstRef.current?.finish(), []);
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
        arrowBurstRef.current?.finish();
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
      onChange={(event) => { arrowBurstRef.current?.finish(); setDraft(event.currentTarget.value); }}
      onBlur={() => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
          arrowBurstRef.current?.finish();
          return;
        }
        const arrowWasActive = arrowAdjustingRef.current;
        arrowBurstRef.current?.finish();
        if (!arrowWasActive) commitDraft();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          skipBlurCommitRef.current = true;
          if (!arrowAdjustingRef.current) commitDraft();
          arrowBurstRef.current?.finish();
          event.currentTarget.blur();
        }
        else if (event.key === "Escape") { skipBlurCommitRef.current = true; arrowBurstRef.current?.finish(); setDraft(String(valueRef.current)); event.currentTarget.blur(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const multiplier = event.shiftKey ? 10 : 1;
          const next = clamp(arrowValueRef.current + (event.key === "ArrowUp" ? step : -step) * multiplier, min, max);
          if (next === arrowValueRef.current) return;
          arrowValueRef.current = next;
          setDraft(String(next));
          arrowBurstRef.current?.step(next);
        }
      }} />
  </div>;
}

export function CommitColorInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  return <span className="editor-color-input"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
    onChange={(event) => onCommit(event.currentTarget.value)} /><CommitTextInput value={value} onCommit={onCommit} /></span>;
}
