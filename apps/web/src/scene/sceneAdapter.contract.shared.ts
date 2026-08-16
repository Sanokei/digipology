import { describe, expect, test } from "bun:test";
import { createInitialState, type EntityRecord } from "digipology-kernel";

import type { KernelStoreSnapshot } from "../state/kernelStore";
import { handleTouchPointerInput } from "./sceneInteraction";
import type { HighlightKind, SceneAdapter } from "./sceneAdapter";
import { TouchGestureMachine, type TouchGestureDecision } from "./touchGestures";

export interface ContractPiece {
  readonly identity: object;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly disposed: boolean;
}

export interface MountedContractAdapter {
  adapter: SceneAdapter;
  hasPointerCapture(pointerId: number): boolean;
  piece(entityId: string): ContractPiece | null;
  setPick(entityId: string | null): void;
  tick(deltaMs: number): void;
  highlight(entityId: string, kind: HighlightKind): boolean;
  cameraCounts(): { attached: number; detached: number };
  livePieceCount(): number;
  listenerCount(): number;
  disposed(): boolean;
}

export interface SceneAdapterContractHarness {
  name: "lite" | "webgl";
  handlesDesktopDrag: boolean;
  supportedHighlights: readonly HighlightKind[];
  mount(sendAction?: (action: { type: string; payload: unknown }) => unknown): Promise<MountedContractAdapter>;
}

export function contractTransform(x: number, z = 2) {
  return {
    position: { x, y: 0.2, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 2, y: 1, z: 2 },
  };
}

export function contractCard(x = 1, faceUp = true): EntityRecord {
  return {
    id: "card-1",
    components: {
      card: { definitionId: "card", faceUp },
      grabbable: { enabled: true, heldBy: null },
      transform: contractTransform(x),
    },
  };
}

export function contractDie(): EntityRecord {
  return {
    id: "die-1",
    components: {
      die: { definitionId: "d6", value: 4 },
      transform: contractTransform(-1),
    },
  };
}

export function contractCounter(): EntityRecord {
  return {
    id: "counter-1",
    components: {
      counter: { value: 7, default: 0, min: null, max: null },
      transform: contractTransform(0, -2),
    },
  };
}

export function contractDeck(): EntityRecord {
  return {
    id: "deck-1",
    components: {
      deck: { enabled: true },
      container: { items: ["card-1"], capacity: null, ordering: "top", visibility: "public" },
      transform: contractTransform(0),
    },
  };
}

export function contractButton(): EntityRecord {
  return {
    id: "button-1",
    components: {
      button: { enabled: true, label: "Press me" },
      transform: contractTransform(2, -1),
    },
  };
}

export function contractSnapshot(
  entities: Record<string, EntityRecord>,
  correction: KernelStoreSnapshot["correction"] = null,
): KernelStoreSnapshot {
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
    correction,
    endedReason: null,
    stateHash: null,
    diagnostic: null,
    definitions: { card: { label: "Contract Card", color: "#abcdef" } },
    gameTitle: null,
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

export function runSceneAdapterContract(harness: SceneAdapterContractHarness): void {
  describe(`SceneAdapter contract (${harness.name})`, () => {
    test("syncs create/update/recreate/remove and resolves pick hit/miss", async () => {
      const mounted = await harness.mount(() => undefined);
      const { adapter } = mounted;
      expect(adapter.handlesDesktopDrag).toBe(harness.handlesDesktopDrag);
      adapter.syncEntities(contractSnapshot({
        "card-1": contractCard(),
        "die-1": contractDie(),
        "counter-1": contractCounter(),
        "button-1": contractButton(),
      }));
      const initialCard = mounted.piece("card-1");
      expect(initialCard).not.toBeNull();
      expect(mounted.piece("button-1")?.label).toBe("Press me");
      expect(mounted.livePieceCount()).toBe(4);

      adapter.syncEntities(contractSnapshot({
        "card-1": contractCard(3),
        "die-1": contractDie(),
        "counter-1": contractCounter(),
        "button-1": contractButton(),
      }));
      expect(mounted.piece("card-1")?.identity).toBe(initialCard?.identity);
      expect(mounted.piece("card-1")?.x).toBe(3);

      adapter.syncEntities(contractSnapshot({
        "card-1": contractCard(3, false),
        "die-1": contractDie(),
        "counter-1": contractCounter(),
        "button-1": contractButton(),
      }));
      expect(mounted.piece("card-1")?.identity).not.toBe(initialCard?.identity);
      expect(initialCard?.disposed).toBeTrue();

      mounted.setPick("card-1");
      expect(await adapter.pick(12, 18)).toBe("card-1");
      mounted.setPick(null);
      expect(await adapter.pick(12, 18)).toBeNull();

      adapter.syncEntities(contractSnapshot({ "card-1": contractCard(3, false) }));
      expect(mounted.piece("die-1")).toBeNull();
      expect(mounted.livePieceCount()).toBe(1);
      adapter.dispose();
    });

    test("routes touch drag through canonical grab/drop payloads", async () => {
      const actions: Array<{ type: string; payload: unknown }> = [];
      const mounted = await harness.mount((action) => actions.push(action));
      const { adapter } = mounted;
      adapter.syncEntities(contractSnapshot({ "card-1": contractCard() }));
      mounted.setPick("card-1");
      expect(adapter.isGrabbable("card-1")).toBeTrue();
      const gestures = new TouchGestureMachine();

      applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
        type: "down", pointerId: 4, x: 50, y: 50, pickX: 50, pickY: 50,
        timestamp: 0, pointerType: "touch",
      }));
      applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
        type: "move", pointerId: 4, x: 60, y: 50, pickX: 60, pickY: 50,
        timestamp: 10, pointerType: "touch",
      }));
      applyDecisions(adapter, await handleTouchPointerInput(gestures, adapter, {
        type: "up", pointerId: 4, x: 65, y: 50, pickX: 65, pickY: 50,
        timestamp: 20, pointerType: "touch",
      }));

      expect(actions).toEqual([
        { type: "entity.grab", payload: { entityId: "card-1" } },
        {
          type: "entity.drop",
          payload: {
            entityId: "card-1",
            transform: {
              position: { x: expect.any(Number), y: 0.045, z: expect.any(Number) },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 2, y: 1, z: 2 },
            },
          },
        },
      ]);
      expect(mounted.hasPointerCapture(4)).toBeFalse();
      adapter.dispose();
    });

    test("does not expose or start dragging without an action sender", async () => {
      const mounted = await harness.mount();
      mounted.adapter.syncEntities(contractSnapshot({ "card-1": contractCard() }));
      const originalY = mounted.piece("card-1")?.y;
      expect(mounted.adapter.isGrabbable("card-1")).toBeFalse();
      mounted.adapter.beginDrag("card-1", 9, 50, 50);
      expect(mounted.hasPointerCapture(9)).toBeFalse();
      expect(mounted.piece("card-1")?.y).toBe(originalY);
      mounted.adapter.dispose();
    });

    test("does not expose remotely held or locked pieces as grabbable", async () => {
      const mounted = await harness.mount(() => undefined);
      const held = contractCard();
      held.components.grabbable!.heldBy = "other";
      const locked = { ...contractCard(2), id: "card-2" };
      locked.components.lockable = { locked: true };
      mounted.adapter.syncEntities(contractSnapshot({ "card-1": held, "card-2": locked }));
      expect(mounted.adapter.isGrabbable("card-1")).toBeFalse();
      expect(mounted.adapter.isGrabbable("card-2")).toBeFalse();
      mounted.adapter.dispose();
    });

    test("projects canvas points to the table plane and rejects off-canvas points", async () => {
      const mounted = await harness.mount();
      const point = mounted.adapter.projectToTable(50, 50);
      expect(point).not.toBeNull();
      expect(point?.y).toBe(0);
      expect(mounted.adapter.projectToTable(-1, 50)).toBeNull();
      expect(mounted.adapter.projectToTable(101, 50)).toBeNull();
      mounted.adapter.dispose();
    });

    test("hides contained pieces and hands while rendering a pickable deck pile count", async () => {
      const mounted = await harness.mount(() => undefined);
      mounted.adapter.syncEntities(contractSnapshot({
        "card-1": contractCard(),
        "deck-1": contractDeck(),
        hand: { id: "hand", components: { hand: { owner: "seat_1", canonicalOrder: true }, container: { items: [], capacity: null, ordering: "canonical", visibility: "owner:seat_1" } } },
      }));
      expect(mounted.piece("card-1")).toBeNull();
      expect(mounted.piece("hand")).toBeNull();
      expect(mounted.piece("deck-1")?.label).toBe("Deck · 1");
      mounted.setPick("deck-1");
      expect(await mounted.adapter.pick(50, 50)).toBe("deck-1");
      expect(mounted.livePieceCount()).toBe(1);
      mounted.adapter.dispose();
    });

    test("applies the adapter's documented hover/selected/held highlight affordances", async () => {
      const mounted = await harness.mount(() => undefined);
      mounted.adapter.syncEntities(contractSnapshot({ "card-1": contractCard() }));
      for (const kind of ["hover", "selected", "held", "locked"] as const) {
        mounted.adapter.setHighlight("card-1", kind);
        expect(mounted.highlight("card-1", kind)).toBe(harness.supportedHighlights.includes(kind));
        mounted.adapter.setHighlight(null, kind);
      }
      mounted.adapter.dispose();
    });

    test("keeps held and locked highlights on multiple pieces", async () => {
      const mounted = await harness.mount(() => undefined);
      const second = { ...contractCard(2), id: "card-2" };
      mounted.adapter.syncEntities(contractSnapshot({ "card-1": contractCard(), "card-2": second }));
      mounted.adapter.setHighlight("card-1", "held");
      mounted.adapter.setHighlight("card-2", "held");
      expect(mounted.highlight("card-1", "held")).toBeTrue();
      expect(mounted.highlight("card-2", "held")).toBeTrue();
      mounted.adapter.setHighlight(null, "held");
      mounted.adapter.setHighlight("card-1", "locked");
      mounted.adapter.setHighlight("card-2", "locked");
      expect(mounted.highlight("card-1", "locked")).toBeTrue();
      expect(mounted.highlight("card-2", "locked")).toBeTrue();
      mounted.adapter.dispose();
    });

    test("eases corrections to the target over 180 ms", async () => {
      const mounted = await harness.mount(() => undefined);
      mounted.adapter.syncEntities(contractSnapshot({ "card-1": contractCard(0) }));
      const piece = mounted.piece("card-1");
      mounted.adapter.syncEntities(contractSnapshot(
        { "card-1": contractCard(6) },
        { id: 1, entityId: "card-1", message: "corrected" },
      ));
      expect(piece?.x).toBe(0);
      mounted.tick(90);
      expect(piece?.x).toBeGreaterThan(0);
      expect(piece?.x).toBeLessThan(6);
      mounted.tick(90);
      expect(piece?.x).toBe(6);
      mounted.adapter.dispose();
    });

    test("attaches/detaches the camera, cancels a paused drag, and disposes cleanly", async () => {
      const mounted = await harness.mount(() => undefined);
      const { adapter } = mounted;
      adapter.syncEntities(contractSnapshot({ "card-1": contractCard() }));
      const initialCamera = mounted.cameraCounts();
      adapter.camera.detach();
      adapter.camera.attach();
      expect(mounted.cameraCounts().detached).toBeGreaterThan(initialCamera.detached);
      expect(mounted.cameraCounts().attached).toBeGreaterThan(initialCamera.attached);

      adapter.beginDrag("card-1", 7, 50, 50);
      expect(mounted.hasPointerCapture(7)).toBeTrue();
      adapter.setPaused(true);
      expect(mounted.hasPointerCapture(7)).toBeFalse();
      adapter.dispose();
      expect(mounted.livePieceCount()).toBe(0);
      expect(mounted.listenerCount()).toBe(0);
      expect(mounted.disposed()).toBeTrue();
      expect(adapter.isGrabbable("card-1")).toBeFalse();
    });
  });
}
