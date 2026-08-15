import { describe, expect, it } from "bun:test";
import { applyOrdered, createInitialState, snapshot, type CanonicalGameState, type TransformComponent } from "digipology-kernel";
import type { OrderedAction, PlayerInfo } from "digipology-protocol";
import { KernelStore, type PredictionAction } from "./kernelStore";

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

const PLAYERS: PlayerInfo[] = [
  { playerId: "alice", displayName: "Alice", seatId: null, connected: true },
  { playerId: "bob", displayName: "Bob", seatId: null, connected: true },
];
const IDENTITY: TransformComponent = {
  position: { x: 0, y: 0.1, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function predictionInitial(sequence = 0): CanonicalGameState {
  const state = createInitialState({
    releaseId: "release_prediction",
    rng: { algorithm: "sfc32-v1", state: [11, 22, 33, 44], draws: 0 },
    entities: {
      token_a: { id: "token_a", components: { transform: IDENTITY, grabbable: { enabled: true, heldBy: null }, flippable: { flipped: false } } },
      token_b: { id: "token_b", components: { transform: { ...IDENTITY, position: { x: 2, y: 0.1, z: 0 } }, grabbable: { enabled: true, heldBy: null }, flippable: { flipped: false } } },
    },
  });
  state.sequence = sequence;
  return state;
}

function predictionStore(sequence = 0): KernelStore {
  const store = new KernelStore();
  store.loadRelease({ releaseId: "release_prediction", initialSnapshot: snapshot(predictionInitial(sequence)) } as unknown as Parameters<KernelStore["loadRelease"]>[0]);
  expect(store.bootstrap(sequence, PLAYERS)).toEqual({ ok: true });
  return store;
}

function predictionOrdered(
  sequence: number,
  action: PredictionAction,
  playerId: string,
  requestId?: string,
): OrderedAction {
  return {
    type: "ordered_action",
    protocolVersion: 1,
    sequence,
    actionId: `ordered_${sequence}_${playerId}`,
    ...(requestId === undefined ? {} : { requestId }),
    actor: { type: "player", playerId },
    action,
  };
}

function grab(entityId: string): PredictionAction {
  return { type: "entity.grab", payload: { entityId } };
}

function flip(entityId: string): PredictionAction {
  return { type: "entity.flip", payload: { entityId } };
}

function drop(entityId: string, x: number, z: number): PredictionAction {
  return {
    type: "entity.drop",
    payload: { entityId, transform: { ...IDENTITY, position: { x, y: 0.1, z } } },
  };
}

describe("KernelStore", () => {
  it("does not activate the creator runtime for immutable legacy Lua without script bindings", async () => {
    const store = loaded();
    await store.loadScriptRuntime({
      releaseId: "release_test",
      initialSnapshot: snapshot(initial()),
      files: [{ path: "scripts/game.lua", content: "return {}" }],
    } as unknown as Parameters<KernelStore["loadScriptRuntime"]>[0]);
    expect(store.hasScriptRuntime()).toBe(false);
  });

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

  it("confirms the ledger head without replacing a hash-equal displayed state", () => {
    const store = predictionStore();
    const confirmed = store.getSnapshot().state;
    expect(store.predictLocal({ requestId: "req-grab", action: grab("token_a"), predictedAtSequence: 0 }, "alice")).toBe(true);
    const predicted = store.getSnapshot().displayedState;
    expect(store.getSnapshot().state).toBe(confirmed);
    expect(predicted?.entities.token_a?.components.grabbable?.heldBy).toBe("alice");

    store.applyOrdered(predictionOrdered(1, grab("token_a"), "alice", "req-grab"));
    expect(store.getSnapshot().displayedState).toBe(predicted);
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().stateHash).toBe(snapshot(store.getSnapshot().state!).stateHash);
  });

  it("shows a predicted drop immediately and confirms the grab/drop chain without a re-snap", () => {
    const store = predictionStore();
    store.predictLocal({ requestId: "req-grab", action: grab("token_a"), predictedAtSequence: 0 }, "alice");
    store.predictLocal({ requestId: "req-drop", action: drop("token_a", 3, -2), predictedAtSequence: 0 }, "alice");
    const predicted = store.getSnapshot().displayedState;
    expect(store.getSnapshot().state?.entities.token_a?.components.transform?.position).toEqual(IDENTITY.position);
    expect(predicted?.entities.token_a?.components.transform?.position).toEqual({ x: 3, y: 0.1, z: -2 });
    expect(predicted?.entities.token_a?.components.grabbable?.heldBy).toBeNull();

    store.applyOrdered(predictionOrdered(1, grab("token_a"), "alice", "req-grab"));
    expect(store.getSnapshot().displayedState).toBe(predicted);
    store.applyOrdered(predictionOrdered(2, drop("token_a", 3, -2), "alice", "req-drop"));
    expect(store.getSnapshot().displayedState).toBe(predicted);
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
  });

  it("reconciles an own confirmation that arrives out of prediction order", () => {
    const store = predictionStore();
    store.predictLocal({ requestId: "req-first", action: flip("token_a"), predictedAtSequence: 0 }, "alice");
    store.predictLocal({ requestId: "req-second", action: flip("token_a"), predictedAtSequence: 0 }, "alice");
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.flippable?.flipped).toBe(false);

    store.applyOrdered(predictionOrdered(1, flip("token_a"), "alice", "req-second"));
    expect(store.getSnapshot().predictionLedger.map(({ requestId }) => requestId)).toEqual(["req-first"]);
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.flippable?.flipped).toBe(false);
    store.applyOrdered(predictionOrdered(2, flip("token_a"), "alice", "req-first"));
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.flippable?.flipped).toBe(false);
  });

  it("drops an invalid grab while replaying a still-valid flip in order", () => {
    const store = predictionStore();
    store.predictLocal({ requestId: "alice-grab", action: grab("token_a"), predictedAtSequence: 0 }, "alice");
    store.predictLocal({ requestId: "alice-flip", action: flip("token_b"), predictedAtSequence: 0 }, "alice");

    store.applyOrdered(predictionOrdered(1, grab("token_a"), "bob", "bob-grab"));
    expect(store.getSnapshot().predictionLedger.map(({ requestId }) => requestId)).toEqual(["alice-flip"]);
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.grabbable?.heldBy).toBe("bob");
    expect(store.getSnapshot().displayedState?.entities.token_b?.components.flippable?.flipped).toBe(true);
    expect(store.getSnapshot().correction?.message).toBe("Bob is holding this");

    store.applyOrdered(predictionOrdered(2, grab("token_a"), "alice", "alice-grab"));
    store.applyOrdered(predictionOrdered(3, flip("token_b"), "alice", "alice-flip"));
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().state?.entities.token_b?.components.flippable?.flipped).toBe(true);
  });

  it("rejects a locally invalid prediction without tracking it", () => {
    const store = predictionStore();
    store.applyOrdered(predictionOrdered(1, grab("token_a"), "bob"));
    const displayed = store.getSnapshot().displayedState;
    expect(store.predictLocal({ requestId: "invalid", action: grab("token_a"), predictedAtSequence: 1 }, "alice")).toBe(false);
    expect(store.getSnapshot().displayedState).toBe(displayed);
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().correction?.message).toBe("Bob is holding this");
  });

  it("clears predictions on snapshot replacement and room end", () => {
    const store = predictionStore();
    store.predictLocal({ requestId: "before-resync", action: flip("token_a"), predictedAtSequence: 0 }, "alice");
    const replacement = predictionInitial(8);
    replacement.entities.token_a!.components.flippable!.flipped = true;
    store.replaceSnapshot(snapshot(replacement));
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().displayedState).toBe(store.getSnapshot().state);

    store.predictLocal({ requestId: "before-end", action: flip("token_b"), predictedAtSequence: 8 }, "alice");
    store.roomEnded("host_ended");
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().displayedState).toBe(store.getSnapshot().state);
  });

  it("drops lost pending predictions and surfaces a visible rollback as a correction", () => {
    const store = predictionStore();
    store.predictLocal({ requestId: "lost-flip", action: flip("token_a"), predictedAtSequence: 0 }, "alice");
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.flippable?.flipped).toBe(true);

    store.dropPendingRequests();

    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().displayedState).toBe(store.getSnapshot().state);
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.flippable?.flipped).toBe(false);
    expect(store.getSnapshot().correction?.message).toBe("The table changed before that action could finish.");
  });

  it("revalidates predictions while applying a resume stream", () => {
    const store = predictionStore();
    store.predictLocal({ requestId: "alice-grab", action: grab("token_a"), predictedAtSequence: 0 }, "alice");
    expect(store.applyResume({
      type: "resume", protocolVersion: 1, fromSequence: 1,
      actions: [predictionOrdered(1, grab("token_a"), "bob", "bob-grab")],
    })).toEqual({ ok: true });
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().displayedState?.entities.token_a?.components.grabbable?.heldBy).toBe("bob");
    expect(store.getSnapshot().correction?.message).toBe("Bob is holding this");
  });

  it("simulates the mandatory Alice/Bob conflicting-grab timeline at sequences 501/502", () => {
    const alice = predictionStore(500);
    const bob = predictionStore(500);
    expect(alice.predictLocal({ requestId: "alice-502", action: grab("token_a"), predictedAtSequence: 500 }, "alice")).toBe(true);
    expect(bob.predictLocal({ requestId: "bob-501", action: grab("token_a"), predictedAtSequence: 500 }, "bob")).toBe(true);
    expect(alice.getSnapshot().displayedState?.entities.token_a?.components.grabbable?.heldBy).toBe("alice");
    expect(bob.getSnapshot().displayedState?.entities.token_a?.components.grabbable?.heldBy).toBe("bob");

    const bobWins = predictionOrdered(501, grab("token_a"), "bob", "bob-501");
    alice.applyOrdered(bobWins);
    bob.applyOrdered(bobWins);
    expect(bob.getSnapshot().predictionLedger).toHaveLength(0);
    expect(alice.getSnapshot().predictionLedger).toHaveLength(0);
    expect(alice.getSnapshot().displayedState?.entities.token_a?.components.grabbable?.heldBy).toBe("bob");
    expect(alice.getSnapshot().correction?.message).toBe("Bob is holding this");

    const aliceLoses = predictionOrdered(502, grab("token_a"), "alice", "alice-502");
    alice.applyOrdered(aliceLoses);
    bob.applyOrdered(aliceLoses);
    expect(alice.getSnapshot().diagnostic).toContain("rejected by kernel");
    expect(bob.getSnapshot().diagnostic).toContain("rejected by kernel");
    expect(alice.getSnapshot().stateHash).toBe(bob.getSnapshot().stateHash);
    expect(alice.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(bob.getSnapshot().pendingRequestIds.size).toBe(0);

    let clean = predictionInitial(500);
    clean = applyOrdered(clean, { sequence: 501, actionId: bobWins.actionId, actor: bobWins.actor, action: bobWins.action }).state;
    clean = applyOrdered(clean, { sequence: 502, actionId: aliceLoses.actionId, actor: aliceLoses.actor, action: aliceLoses.action }).state;
    expect(alice.getSnapshot().stateHash).toBe(snapshot(clean).stateHash);
  });

  it("keeps confirmed hashes equal to clean replay across seeded randomized interleavings", () => {
    for (let seed = 1; seed <= 16; seed += 1) {
      let randomState = seed;
      const random = () => {
        randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
        return randomState / 0x1_0000_0000;
      };
      const store = predictionStore();
      let clean = predictionInitial();
      let nextRequest = 0;
      for (let round = 0; round < 12; round += 1) {
        const batch: Array<{ action: PredictionAction; playerId: string; requestId?: string }> = [];
        const predictionCount = 1 + Math.floor(random() * 3);
        for (let index = 0; index < predictionCount; index += 1) {
          const entityId = random() < 0.5 ? "token_a" : "token_b";
          const choice = Math.floor(random() * 3);
          const action = choice === 0 ? grab(entityId) : choice === 1 ? drop(entityId, Math.floor(random() * 7) - 3, Math.floor(random() * 5) - 2) : flip(entityId);
          const requestId = `seed-${seed}-req-${nextRequest}`;
          nextRequest += 1;
          if (store.predictLocal({ requestId, action, predictedAtSequence: store.getSnapshot().state!.sequence }, "alice")) {
            batch.push({ action, playerId: "alice", requestId });
          }
        }
        const remoteEntity = random() < 0.5 ? "token_a" : "token_b";
        const remoteChoice = Math.floor(random() * 3);
        batch.push({
          action: remoteChoice === 0 ? grab(remoteEntity) : remoteChoice === 1 ? drop(remoteEntity, 0, 0) : flip(remoteEntity),
          playerId: "bob",
        });
        for (let index = batch.length - 1; index > 0; index -= 1) {
          const swap = Math.floor(random() * (index + 1));
          [batch[index], batch[swap]] = [batch[swap]!, batch[index]!];
        }
        for (const item of batch) {
          const sequence = clean.sequence + 1;
          const message = predictionOrdered(sequence, item.action, item.playerId, item.requestId);
          expect(store.applyOrdered(message)).toEqual({ ok: true });
          clean = applyOrdered(clean, { sequence, actionId: message.actionId, actor: message.actor, action: message.action }).state;
        }
      }
      expect(store.getSnapshot().predictionLedger).toHaveLength(0);
      expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
      expect(store.getSnapshot().stateHash).toBe(snapshot(clean).stateHash);
    }
  });
});
