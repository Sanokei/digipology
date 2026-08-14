import { describe, expect, it } from "bun:test";
import { createInitialState, snapshot, type CanonicalGameState } from "digipology-kernel";
import type { OrderedAction } from "digipology-protocol";
import { KernelStore } from "./kernelStore";

function initial(value = 1): CanonicalGameState {
  return createInitialState({
    releaseId: "release_test", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    entities: { counter: { id: "counter", components: { counter: { value, default: 0, min: null, max: null } } } },
  });
}
function ordered(sequence: number, requestId?: string): OrderedAction {
  return {
    type: "ordered_action", protocolVersion: 1, sequence, actionId: `a${sequence}`,
    ...(requestId === undefined ? {} : { requestId }), actor: { type: "player", playerId: "p1" },
    action: { type: "counter.add", payload: { entityId: "counter", amount: 1 } },
  };
}
function loaded(value = 1): KernelStore {
  const store = new KernelStore();
  store.loadRelease({ releaseId: "release_test", initialSnapshot: snapshot(initial(value)) } as unknown as Parameters<KernelStore["loadRelease"]>[0]);
  return store;
}

describe("KernelStore", () => {
  it("applies ordered actions strictly in order", () => {
    const store = loaded();
    expect(store.applyOrdered(ordered(1))).toEqual({ ok: true });
    expect(store.getSnapshot().state?.entities.counter?.components.counter?.value).toBe(2);
    const before = store.getSnapshot().stateHash;
    expect(store.applyOrdered(ordered(3))).toEqual({ ok: false, expected: 2, actual: 3 });
    expect(store.getSnapshot().stateHash).toBe(before);
  });

  it("replays resume actions from lastSequence", () => {
    const store = loaded(); store.applyOrdered(ordered(1));
    expect(store.applyResume({ type: "resume", protocolVersion: 1, fromSequence: 2, actions: [ordered(2), ordered(3)] })).toEqual({ ok: true });
    expect(store.getSnapshot().state?.sequence).toBe(3);
  });

  it("replaces state on resync", () => {
    const store = loaded(); store.applyOrdered(ordered(1));
    const replacement = initial(10); replacement.sequence = 4;
    store.replaceSnapshot(snapshot(replacement));
    expect(store.getSnapshot().state?.sequence).toBe(4);
    expect(store.getSnapshot().state?.entities.counter?.components.counter?.value).toBe(10);
  });

  it("confirms matching request IDs and handles room end", () => {
    const store = loaded(); store.trackRequest("req-1"); store.trackRequest("req-2");
    store.applyOrdered(ordered(1, "req-1"));
    expect([...store.getSnapshot().pendingRequestIds]).toEqual(["req-2"]);
    store.roomEnded("expired");
    expect(store.getSnapshot().endedReason).toBe("expired");
  });
});
