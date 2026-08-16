import { describe, expect, test } from "bun:test";
import { createInitialState, type EntityRecord } from "digipology-kernel";

import type { KernelStoreSnapshot } from "../state/kernelStore";
import { createDragActionCallbacks } from "./dragActions";
import { handleTouchPointerInput } from "./sceneInteraction";
import type { HighlightKind, SceneAdapter } from "./sceneAdapter";
import { TouchGestureMachine, type TouchGestureDecision } from "./touchGestures";

interface FakePiece {
  position: { x: number; y: number; z: number };
  grabbable: boolean;
}

class ContractFakeAdapter implements SceneAdapter {
  readonly handlesDesktopDrag: boolean;
  readonly pieces = new Map<string, FakePiece>();
  readonly highlights: Record<HighlightKind, string | null> = { hover: null, selected: null, held: null };
  mounted = false;
  disposed = false;
  paused = false;
  renderLoop = false;
  cameraAttached = true;
  pickResult: string | null = null;
  private view: KernelStoreSnapshot | null = null;
  private activeDrag: { entityId: string; pointerId: number; callbacks: ReturnType<typeof createDragActionCallbacks> } | null = null;

  constructor(
    renderer: "webgl" | "lite",
    private readonly send: (action: { type: string; payload: unknown }) => unknown,
  ) {
    this.handlesDesktopDrag = renderer === "webgl";
  }

  async mount(_canvas: HTMLCanvasElement, _options: { tier: "default" | "low" }): Promise<void> {
    this.mounted = true;
  }

  dispose(): void {
    this.pieces.clear();
    this.disposed = true;
    this.mounted = false;
  }

  syncEntities(view: KernelStoreSnapshot): void {
    this.view = view;
    const entities = view.displayedState?.entities ?? {};
    for (const id of this.pieces.keys()) {
      if (!(id in entities)) this.pieces.delete(id);
    }
    for (const [id, entity] of Object.entries(entities)) {
      const position = entity.components.transform?.position ?? { x: 0, y: 0, z: 0 };
      this.pieces.set(id, {
        position: { ...position },
        grabbable: entity.components.grabbable?.enabled === true,
      });
    }
  }

  async pick(): Promise<string | null> {
    return this.pickResult;
  }

  isGrabbable(entityId: string): boolean {
    return this.pieces.get(entityId)?.grabbable === true;
  }

  beginDrag(entityId: string, pointerId: number): void {
    if (this.paused || !this.isGrabbable(entityId)) return;
    const callbacks = createDragActionCallbacks(
      entityId,
      this.send,
      () => this.view?.displayedState?.entities[entityId]?.components.transform,
      () => !this.paused,
    );
    this.activeDrag = { entityId, pointerId, callbacks };
    this.highlights.held = entityId;
    callbacks.onGrab();
  }

  updateDrag(pointerId: number, x: number, y: number): void {
    if (this.activeDrag?.pointerId !== pointerId) return;
    const piece = this.pieces.get(this.activeDrag.entityId);
    if (piece !== undefined) piece.position = { x, y: 0.2, z: y };
  }

  endDrag(pointerId: number): void {
    if (this.activeDrag?.pointerId !== pointerId) return;
    const piece = this.pieces.get(this.activeDrag.entityId);
    if (piece !== undefined) this.activeDrag.callbacks.onDrop(piece.position);
    this.activeDrag = null;
    this.highlights.held = null;
  }

  cancelDrag(pointerId: number): void {
    this.endDrag(pointerId);
  }

  setHighlight(entityId: string | null, kind: HighlightKind): void {
    this.highlights[kind] = entityId;
  }

  camera = {
    attach: (): void => { this.cameraAttached = true; },
    detach: (): void => { this.cameraAttached = false; },
    pan: (_dx: number, _dy: number): void => undefined,
    pinch: (_previous: number, _next: number): void => undefined,
  };

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  resize(): void {}

  setRenderLoop(running: boolean): void {
    this.renderLoop = running;
  }
}

function snapshot(entities: Record<string, EntityRecord>): KernelStoreSnapshot {
  const state = createInitialState({
    releaseId: "contract-release",
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    entities,
  });
  return {
    state,
    displayedState: state,
    events: [],
    players: [],
    pendingRequestIds: new Set(),
    predictionLedger: [],
    correction: null,
    endedReason: null,
    stateHash: null,
    diagnostic: null,
    definitions: {},
    gameTitle: null,
  };
}

function piece(x = 1): EntityRecord {
  return {
    id: "piece-1",
    components: {
      card: { definitionId: "card", faceUp: true },
      grabbable: { enabled: true, heldBy: null },
      transform: {
        position: { x, y: 0.2, z: 2 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 2, y: 1, z: 2 },
      },
    },
  };
}

function applyDecisions(adapter: SceneAdapter, decisions: readonly TouchGestureDecision[]): void {
  for (const decision of decisions) {
    if (decision.type === "drag-start") {
      adapter.beginDrag(decision.entityId, decision.pointerId, decision.x, decision.y);
    } else if (decision.type === "drag-move") {
      adapter.updateDrag(decision.pointerId, decision.x, decision.y);
    } else if (decision.type === "drag-end") {
      adapter.updateDrag(decision.pointerId, decision.x, decision.y);
      adapter.endDrag(decision.pointerId);
    }
  }
}

for (const renderer of ["webgl", "lite"] as const) {
  describe(`${renderer} SceneAdapter contract through its thin engine fake`, () => {
    test("syncs lifecycle, awaits picks, preserves drag payloads, highlights, and disposes", async () => {
      const actions: Array<{ type: string; payload: unknown }> = [];
      const adapter = new ContractFakeAdapter(renderer, (action) => actions.push(action));
      await adapter.mount({} as HTMLCanvasElement, { tier: "default" });
      adapter.syncEntities(snapshot({ "piece-1": piece() }));
      expect(adapter.pieces.get("piece-1")?.position.x).toBe(1);
      adapter.syncEntities(snapshot({ "piece-1": piece(3) }));
      expect(adapter.pieces.get("piece-1")?.position.x).toBe(3);

      adapter.pickResult = "piece-1";
      const gestures = new TouchGestureMachine();
      applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
        type: "down",
        pointerId: 4,
        x: 10,
        y: 10,
        pickX: 10,
        pickY: 10,
        timestamp: 0,
        pointerType: "touch",
      }));
      applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
        type: "move",
        pointerId: 4,
        x: 20,
        y: 12,
        pickX: 20,
        pickY: 12,
        timestamp: 10,
        pointerType: "touch",
      }));
      applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
        type: "up",
        pointerId: 4,
        x: 24,
        y: 14,
        pickX: 24,
        pickY: 14,
        timestamp: 20,
        pointerType: "touch",
      }));
      expect(actions).toEqual([
        { type: "entity.grab", payload: { entityId: "piece-1" } },
        {
          type: "entity.drop",
          payload: {
            entityId: "piece-1",
            transform: {
              position: { x: 24, y: 0.2, z: 14 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 2, y: 1, z: 2 },
            },
          },
        },
      ]);

      adapter.setHighlight("piece-1", "selected");
      expect(adapter.highlights.selected).toBe("piece-1");
      adapter.syncEntities(snapshot({}));
      expect(adapter.pieces.size).toBe(0);
      adapter.dispose();
      expect(adapter.disposed).toBeTrue();
    });
  });
}
