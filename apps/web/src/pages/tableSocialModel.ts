import type { ChatMessage } from "digipology-protocol";

export const CHAT_HISTORY_LIMIT = 100;
export const REMOTE_CURSOR_IDLE_MS = 3_000;
export const TABLE_PING_LIFETIME_MS = 2_000;

export interface ChatLine {
  id: number;
  message: ChatMessage;
}

export interface ChatModel {
  open: boolean;
  unread: number;
  nextId: number;
  lines: readonly ChatLine[];
}

export type ChatModelEvent =
  | { type: "reset" }
  | { type: "open" }
  | { type: "close" }
  | { type: "message"; message: ChatMessage };

export function createChatModel(): ChatModel {
  return { open: false, unread: 0, nextId: 1, lines: [] };
}

export function reduceChatModel(model: ChatModel, event: ChatModelEvent): ChatModel {
  if (event.type === "reset") return createChatModel();
  if (event.type === "open") return { ...model, open: true, unread: 0 };
  if (event.type === "close") return { ...model, open: false };
  const line = { id: model.nextId, message: event.message };
  return {
    ...model,
    nextId: model.nextId + 1,
    unread: model.open ? 0 : model.unread + 1,
    lines: [...model.lines, line].slice(-CHAT_HISTORY_LIMIT),
  };
}

interface TimerScheduler {
  set(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
}

/** Latest-state-wins throttle used for transient remote cursor broadcasts. */
export class CursorThrottle<T> {
  private lastSentAt: number | null = null;
  private pending: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (value: T) => void,
    private readonly intervalMs = 80,
    private readonly now: () => number = () => performance.now(),
    private readonly timers: TimerScheduler = {
      set: (callback, delay) => setTimeout(callback, delay),
      clear: (timer) => clearTimeout(timer),
    },
  ) {}

  push(value: T): void {
    const now = this.now();
    if (this.lastSentAt === null || now - this.lastSentAt >= this.intervalMs) {
      this.lastSentAt = now;
      this.pending = null;
      this.send(value);
      return;
    }
    this.pending = value;
    if (this.timer !== null) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      const next = this.pending;
      this.pending = null;
      if (next === null) return;
      this.lastSentAt = this.now();
      this.send(next);
    }, Math.max(0, this.intervalMs - (now - this.lastSentAt)));
  }

  cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.pending = null;
    this.lastSentAt = null;
  }
}
