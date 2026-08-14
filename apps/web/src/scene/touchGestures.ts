export interface GestureTarget {
  entityId: string;
  grabbable: boolean;
}

export interface NormalizedPointerEvent {
  type: "down" | "move" | "up" | "cancel";
  pointerId: number;
  x: number;
  y: number;
  timestamp: number;
  pointerType: string;
  target?: GestureTarget | null;
}

export interface TouchGestureOptions {
  tapSlop: number;
  longPressMs: number;
  doubleTapMs: number;
  pinchSlop: number;
}

export type TouchGestureDecision =
  | { type: "drag-start"; pointerId: number; entityId: string; x: number; y: number }
  | { type: "drag-move"; pointerId: number; entityId: string; x: number; y: number }
  | { type: "drag-end"; pointerId: number; entityId: string; x: number; y: number }
  | { type: "drag-cancel"; pointerId: number; entityId: string }
  | { type: "tap"; entityId: string | null; x: number; y: number }
  | { type: "double-tap"; entityId: string | null; x: number; y: number }
  | { type: "long-press"; entityId: string; x: number; y: number }
  | { type: "camera-start" }
  | { type: "camera-pan"; deltaX: number; deltaY: number }
  | { type: "camera-pinch"; previousDistance: number; distance: number }
  | { type: "camera-end" };

const DEFAULT_OPTIONS: TouchGestureOptions = {
  tapSlop: 8,
  longPressMs: 450,
  doubleTapMs: 300,
  pinchSlop: 8,
};

interface Point {
  x: number;
  y: number;
}

interface TrackedPointer extends Point {
  pointerId: number;
}

interface SingleTouch {
  pointerId: number;
  start: Point;
  current: Point;
  startedAt: number;
  target: GestureTarget | null;
  moved: boolean;
  dragging: boolean;
  longPressFired: boolean;
}

interface MultiTouch {
  pointerIds: [number, number];
  initialCenter: Point;
  initialDistance: number;
  previousCenter: Point;
  previousDistance: number;
  mode: "undecided" | "pan" | "pinch";
}

interface PendingTap extends Point {
  entityId: string | null;
  timestamp: number;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function center(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

/**
 * Pure touch-arbitration state machine. The browser/Babylon layer owns timers,
 * picking, capture, and presentation; this class only turns normalized input
 * into explicit gesture decisions.
 */
export class TouchGestureMachine {
  private readonly options: TouchGestureOptions;
  private readonly pointers = new Map<number, TrackedPointer>();
  private single: SingleTouch | null = null;
  private multi: MultiTouch | null = null;
  private pendingTap: PendingTap | null = null;

  constructor(options: Partial<TouchGestureOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  handle(event: NormalizedPointerEvent): TouchGestureDecision[] {
    if (event.pointerType !== "touch") return [];
    const decisions = this.flushExpiredTap(event.timestamp, false);

    if (event.type === "cancel") {
      decisions.push(...this.abort());
      return decisions;
    }

    if (event.type === "down") {
      const pointer = { pointerId: event.pointerId, x: event.x, y: event.y };
      this.pointers.set(event.pointerId, pointer);
      if (this.pointers.size === 1) {
        this.single = {
          pointerId: event.pointerId,
          start: { x: pointer.x, y: pointer.y },
          current: { x: pointer.x, y: pointer.y },
          startedAt: event.timestamp,
          target: event.target ?? null,
          moved: false,
          dragging: false,
          longPressFired: false,
        };
        return decisions;
      }

      if (this.pointers.size === 2) {
        if (this.single?.dragging === true && this.single.target !== null) {
          decisions.push({
            type: "drag-cancel",
            pointerId: this.single.pointerId,
            entityId: this.single.target.entityId,
          });
        }
        this.single = null;
        this.pendingTap = null;
        const [left, right] = [...this.pointers.values()] as [TrackedPointer, TrackedPointer];
        const midpoint = center(left, right);
        const separation = distance(left, right);
        this.multi = {
          pointerIds: [left.pointerId, right.pointerId],
          initialCenter: midpoint,
          initialDistance: separation,
          previousCenter: midpoint,
          previousDistance: separation,
          mode: "undecided",
        };
        decisions.push({ type: "camera-start" });
      }
      return decisions;
    }

    const tracked = this.pointers.get(event.pointerId);
    if (tracked === undefined) return decisions;
    tracked.x = event.x;
    tracked.y = event.y;

    if (event.type === "move") {
      if (this.multi !== null) {
        decisions.push(...this.moveMultiTouch());
        return decisions;
      }
      if (this.single === null || this.single.pointerId !== event.pointerId) return decisions;
      this.single.current = { x: event.x, y: event.y };
      const movement = distance(this.single.start, this.single.current);
      if (movement > this.options.tapSlop) this.single.moved = true;

      if (!this.single.moved && !this.single.longPressFired && event.timestamp >= this.single.startedAt + this.options.longPressMs) {
        decisions.push(...this.fireLongPress());
      }
      if (this.single.moved && this.single.target?.grabbable === true) {
        if (!this.single.dragging) {
          this.single.dragging = true;
          decisions.push({
            type: "drag-start",
            pointerId: event.pointerId,
            entityId: this.single.target.entityId,
            x: event.x,
            y: event.y,
          });
        }
        decisions.push({
          type: "drag-move",
          pointerId: event.pointerId,
          entityId: this.single.target.entityId,
          x: event.x,
          y: event.y,
        });
      }
      return decisions;
    }

    this.pointers.delete(event.pointerId);
    if (this.multi !== null) {
      if (this.pointers.size < 2) {
        this.multi = null;
        decisions.push({ type: "camera-end" });
      }
      this.single = null;
      return decisions;
    }

    if (this.single === null || this.single.pointerId !== event.pointerId) return decisions;
    const single = this.single;
    this.single = null;
    if (single.dragging && single.target !== null) {
      decisions.push({
        type: "drag-end",
        pointerId: event.pointerId,
        entityId: single.target.entityId,
        x: event.x,
        y: event.y,
      });
    } else if (!single.moved && !single.longPressFired) {
      if (event.timestamp >= single.startedAt + this.options.longPressMs) {
        if (single.target !== null) {
          decisions.push({
            type: "long-press",
            entityId: single.target.entityId,
            x: single.start.x,
            y: single.start.y,
          });
        }
      } else {
        decisions.push(...this.queueTap(single.target?.entityId ?? null, event.x, event.y, event.timestamp));
      }
    }
    return decisions;
  }

  advance(timestamp: number): TouchGestureDecision[] {
    const decisions: TouchGestureDecision[] = [];
    if (this.single !== null && !this.single.moved && !this.single.longPressFired && timestamp >= this.single.startedAt + this.options.longPressMs) {
      decisions.push(...this.fireLongPress());
    }
    decisions.push(...this.flushExpiredTap(timestamp, true));
    return decisions;
  }

  nextDeadline(): number | null {
    const longPressDeadline = this.single !== null && !this.single.moved && !this.single.longPressFired
      ? this.single.startedAt + this.options.longPressMs
      : null;
    const tapDeadline = this.pendingTap === null
      ? null
      : this.pendingTap.timestamp + this.options.doubleTapMs;
    if (longPressDeadline === null) return tapDeadline;
    if (tapDeadline === null) return longPressDeadline;
    return Math.min(longPressDeadline, tapDeadline);
  }

  hasActivePointer(pointerId: number): boolean {
    return this.pointers.has(pointerId);
  }

  abort(): TouchGestureDecision[] {
    const decisions: TouchGestureDecision[] = [];
    if (this.single?.dragging === true && this.single.target !== null) {
      decisions.push({
        type: "drag-cancel",
        pointerId: this.single.pointerId,
        entityId: this.single.target.entityId,
      });
    }
    if (this.multi !== null) decisions.push({ type: "camera-end" });
    this.pointers.clear();
    this.single = null;
    this.multi = null;
    this.pendingTap = null;
    return decisions;
  }

  private fireLongPress(): TouchGestureDecision[] {
    if (this.single === null || this.single.target === null || this.single.moved || this.single.longPressFired) return [];
    this.single.longPressFired = true;
    return [{
      type: "long-press",
      entityId: this.single.target.entityId,
      x: this.single.start.x,
      y: this.single.start.y,
    }];
  }

  private queueTap(entityId: string | null, x: number, y: number, timestamp: number): TouchGestureDecision[] {
    const previous = this.pendingTap;
    if (
      previous !== null &&
      previous.entityId === entityId &&
      timestamp - previous.timestamp <= this.options.doubleTapMs &&
      distance(previous, { x, y }) <= this.options.tapSlop
    ) {
      this.pendingTap = null;
      return [{ type: "double-tap", entityId, x, y }];
    }
    const decisions = previous === null ? [] : [{
      type: "tap" as const,
      entityId: previous.entityId,
      x: previous.x,
      y: previous.y,
    }];
    this.pendingTap = { entityId, x, y, timestamp };
    return decisions;
  }

  private flushExpiredTap(timestamp: number, inclusive: boolean): TouchGestureDecision[] {
    const tap = this.pendingTap;
    if (tap === null) return [];
    const deadline = tap.timestamp + this.options.doubleTapMs;
    if (inclusive ? timestamp < deadline : timestamp <= deadline) return [];
    this.pendingTap = null;
    return [{ type: "tap", entityId: tap.entityId, x: tap.x, y: tap.y }];
  }

  private moveMultiTouch(): TouchGestureDecision[] {
    const multi = this.multi;
    if (multi === null) return [];
    const left = this.pointers.get(multi.pointerIds[0]);
    const right = this.pointers.get(multi.pointerIds[1]);
    if (left === undefined || right === undefined) return [];
    const midpoint = center(left, right);
    const separation = distance(left, right);

    if (multi.mode === "undecided") {
      const separationDelta = Math.abs(separation - multi.initialDistance);
      const centerDelta = distance(midpoint, multi.initialCenter);
      if (separationDelta > this.options.pinchSlop && centerDelta <= this.options.tapSlop) {
        multi.mode = "pinch";
      } else if (centerDelta > this.options.tapSlop && separationDelta <= this.options.pinchSlop) {
        multi.mode = "pan";
      } else {
        return [];
      }
    }

    if (multi.mode === "pinch") {
      const decision: TouchGestureDecision = {
        type: "camera-pinch",
        previousDistance: multi.previousDistance,
        distance: separation,
      };
      multi.previousDistance = separation;
      multi.previousCenter = midpoint;
      return [decision];
    }

    const decision: TouchGestureDecision = {
      type: "camera-pan",
      deltaX: midpoint.x - multi.previousCenter.x,
      deltaY: midpoint.y - multi.previousCenter.y,
    };
    multi.previousCenter = midpoint;
    multi.previousDistance = separation;
    return [decision];
  }
}
