export interface DesktopPointerPoint {
  readonly pointerId: number;
  readonly button: number;
  readonly x: number;
  readonly y: number;
  readonly toggleSelection?: boolean;
  readonly wholeDeck?: boolean;
}

export type DesktopControlDecision =
  | { readonly type: "object-start"; readonly pointerId: number; readonly entityId: string; readonly x: number; readonly y: number; readonly wholeDeck: boolean }
  | { readonly type: "object-move"; readonly pointerId: number; readonly entityId: string; readonly x: number; readonly y: number }
  | { readonly type: "object-drop"; readonly pointerId: number; readonly entityId: string; readonly x: number; readonly y: number }
  | { readonly type: "object-cancel"; readonly pointerId: number; readonly entityId: string }
  | { readonly type: "object-select"; readonly entityId: string; readonly toggle: boolean }
  | { readonly type: "box-start"; readonly pointerId: number; readonly x: number; readonly y: number }
  | { readonly type: "box-move"; readonly pointerId: number; readonly startX: number; readonly startY: number; readonly x: number; readonly y: number }
  | { readonly type: "box-end"; readonly pointerId: number; readonly startX: number; readonly startY: number; readonly x: number; readonly y: number; readonly toggle: boolean }
  | { readonly type: "camera-orbit"; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: "camera-pan"; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: "context"; readonly x: number; readonly y: number };

interface TrackedDesktopPointer {
  readonly pointerId: number;
  readonly button: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  moved: boolean;
  entityId: string | null;
  emptyClaimed: boolean;
  toggleSelection: boolean;
  wholeDeck: boolean;
}

const CLICK_SLOP_PX = 5;

/**
 * Renderer-independent desktop controls modeled on Tabletop Simulator:
 * LMB manipulates objects, RMB orbits, MMB pans, and a stationary RMB click
 * requests the object context menu. Async renderer picks claim the still-live
 * LMB press through `claimObject` without losing pointer movement in between.
 */
export class DesktopControlMachine {
  private readonly pointers = new Map<number, TrackedDesktopPointer>();

  down(point: DesktopPointerPoint): void {
    if (point.button < 0 || point.button > 2) return;
    this.pointers.set(point.pointerId, {
      pointerId: point.pointerId,
      button: point.button,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      moved: false,
      entityId: null,
      emptyClaimed: false,
      toggleSelection: point.toggleSelection === true,
      wholeDeck: point.wholeDeck === true,
    });
  }

  claimObject(pointerId: number, entityId: string): DesktopControlDecision[] {
    const pointer = this.pointers.get(pointerId);
    if (pointer === undefined || pointer.button !== 0 || pointer.entityId !== null) return [];
    pointer.entityId = entityId;
    return [
      { type: "object-select", entityId, toggle: pointer.toggleSelection },
      { type: "object-start", pointerId, entityId, x: pointer.x, y: pointer.y, wholeDeck: pointer.wholeDeck },
    ];
  }

  claimEmpty(pointerId: number): DesktopControlDecision[] {
    const pointer = this.pointers.get(pointerId);
    if (pointer === undefined || pointer.button !== 0 || pointer.entityId !== null || pointer.emptyClaimed) return [];
    pointer.emptyClaimed = true;
    const decisions: DesktopControlDecision[] = [{ type: "box-start", pointerId, x: pointer.startX, y: pointer.startY }];
    if (pointer.moved) decisions.push({
      type: "box-move", pointerId, startX: pointer.startX, startY: pointer.startY, x: pointer.x, y: pointer.y,
    });
    return decisions;
  }

  move(pointerId: number, x: number, y: number): DesktopControlDecision[] {
    const pointer = this.pointers.get(pointerId);
    if (pointer === undefined) return [];
    const deltaX = x - pointer.x;
    const deltaY = y - pointer.y;
    const wasMoved = pointer.moved;
    pointer.x = x;
    pointer.y = y;
    if (Math.hypot(x - pointer.startX, y - pointer.startY) > CLICK_SLOP_PX) pointer.moved = true;
    if (pointer.button === 0 && pointer.entityId !== null) {
      return [{ type: "object-move", pointerId, entityId: pointer.entityId, x, y }];
    }
    if (pointer.button === 0 && pointer.emptyClaimed) {
      return [{ type: "box-move", pointerId, startX: pointer.startX, startY: pointer.startY, x, y }];
    }
    if (!pointer.moved) return [];
    const cameraDeltaX = wasMoved ? deltaX : x - pointer.startX;
    const cameraDeltaY = wasMoved ? deltaY : y - pointer.startY;
    if (deltaX === 0 && deltaY === 0) return [];
    if (pointer.button === 2) return [{ type: "camera-orbit", deltaX: cameraDeltaX, deltaY: cameraDeltaY }];
    if (pointer.button === 1) return [{ type: "camera-pan", deltaX: cameraDeltaX, deltaY: cameraDeltaY }];
    return [];
  }

  up(pointerId: number, x: number, y: number): DesktopControlDecision[] {
    const pointer = this.pointers.get(pointerId);
    if (pointer === undefined) return [];
    this.pointers.delete(pointerId);
    if (pointer.button === 0 && pointer.entityId !== null) {
      return [{ type: "object-drop", pointerId, entityId: pointer.entityId, x, y }];
    }
    if (pointer.button === 0 && pointer.emptyClaimed) {
      return [{ type: "box-end", pointerId, startX: pointer.startX, startY: pointer.startY, x, y, toggle: pointer.toggleSelection }];
    }
    if (pointer.button === 2 && !pointer.moved) return [{ type: "context", x, y }];
    return [];
  }

  cancel(pointerId: number): DesktopControlDecision[] {
    const pointer = this.pointers.get(pointerId);
    if (pointer === undefined) return [];
    this.pointers.delete(pointerId);
    return pointer.entityId === null
      ? []
      : [{ type: "object-cancel", pointerId, entityId: pointer.entityId }];
  }

  abort(): DesktopControlDecision[] {
    const decisions = [...this.pointers.values()]
      .filter((pointer): pointer is TrackedDesktopPointer & { entityId: string } => pointer.entityId !== null)
      .map((pointer): DesktopControlDecision => ({
        type: "object-cancel",
        pointerId: pointer.pointerId,
        entityId: pointer.entityId,
      }));
    this.pointers.clear();
    return decisions;
  }

  activeObject(): { pointerId: number; entityId: string } | null {
    for (const pointer of this.pointers.values()) {
      if (pointer.entityId !== null) return { pointerId: pointer.pointerId, entityId: pointer.entityId };
    }
    return null;
  }
}
