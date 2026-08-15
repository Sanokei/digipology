import { describe, expect, test } from "bun:test";
import type { ActionRequest } from "digipology-protocol";
import { createBuiltinInitialState } from "./initial-state";
import {
  applyOrdered,
  createInitialState,
  loadSnapshot,
  snapshot,
  type GameSnapshot,
} from "digipology-kernel";
import {
  ACTION_RETENTION,
  attestCheckpointCandidate,
  assertCheckpointConnectsToTail,
  checkpointBaseConnects,
  checkpointIsDue,
  CHECKPOINT_INTERVAL,
  replayCheckpoint,
  RoomCore,
  roomBootstrapFromSnapshots,
  retentionFloor,
  roomBootstrapMessages,
  timerFireDedupKey,
  validateCheckpointAttestationSnapshot,
} from "./room-core";

function request(
  index: number,
  payload: unknown = { index },
  actionType = "test.action",
): ActionRequest {
  return {
    type: "action_request",
    protocolVersion: 1,
    requestId: `req_${index}`,
    predictedAtSequence: Math.max(0, index - 1),
    action: { type: actionType, payload },
  };
}

function checkpointInitialSnapshot(): GameSnapshot {
  return snapshot(createInitialState({
    releaseId: "release_checkpoint_test",
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
    entities: {
      score: {
        id: "score",
        components: { counter: { value: 0, default: 0, min: 0, max: 10_000 } },
      },
    },
  }));
}

describe("RoomCore sequencing", () => {
  test("allocates 1000 monotonically increasing sequences and retains 500", () => {
    const core = new RoomCore("room123");
    for (let index = 1; index <= 1000; index += 1) {
      const result = core.sequence(request(index), "player_alice");
      expect(result.duplicate).toBe(false);
      expect(result.orderedAction.sequence).toBe(index);
      expect(result.orderedAction.actionId).toBe(`act_room123_${index}`);
    }
    expect(core.state.lastSequence).toBe(1000);
    expect(core.state.actions).toHaveLength(ACTION_RETENTION);
    expect(core.state.actions[0]?.sequence).toBe(501);
  });

  test("interleaved duplicates return their original mapping", () => {
    const core = new RoomCore("abc");
    const first = core.sequence(request(1), "player_one").orderedAction;
    const second = core.sequence(request(2), "player_one").orderedAction;
    const replay = core.sequence(request(1, { changed: true }), "player_two");
    const third = core.sequence(request(3), "player_two").orderedAction;
    expect(replay.duplicate).toBe(true);
    expect(replay.orderedAction).toEqual(first);
    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3]);
    expect(core.state.lastSequence).toBe(3);
  });

  test("truncates exactly when the 501st action is added", () => {
    const core = new RoomCore("abc");
    for (let index = 1; index <= 501; index += 1) core.sequence(request(index), "p");
    expect(core.state.actions).toHaveLength(500);
    expect(core.state.actions[0]?.sequence).toBe(2);
    expect(retentionFloor(core.state)).toBe(2);
  });

  test("computes resume results at every window edge", () => {
    const core = new RoomCore("abc");
    for (let index = 1; index <= 501; index += 1) core.sequence(request(index), "p");
    const floor = retentionFloor(core.state);
    const atFloor = core.resumeAfter(floor);
    expect(atFloor.type).toBe("resume");
    if (atFloor.type === "resume") {
      expect(atFloor.message.fromSequence).toBe(floor + 1);
      expect(atFloor.message.actions[0]?.sequence).toBe(floor + 1);
    }
    const justBeforeFloor = core.resumeAfter(floor - 1);
    expect(justBeforeFloor.type).toBe("resume");
    if (justBeforeFloor.type === "resume") expect(justBeforeFloor.message.actions[0]?.sequence).toBe(floor);
    expect(core.resumeAfter(floor - 2)).toEqual({ type: "resync_required" });
    expect(core.resumeAfter(501)).toEqual({
      type: "resume",
      message: { type: "resume", protocolVersion: 1, fromSequence: 502, actions: [] },
    });
    expect(core.resumeAfter(502)).toEqual({ type: "invalid_sequence" });
  });

  test("continues without reuse or gap after rebuilding from storage state", () => {
    const before = new RoomCore("abc");
    for (let index = 1; index <= 17; index += 1) before.sequence(request(index), "p");
    const persisted = JSON.parse(JSON.stringify(before.state));
    const after = new RoomCore("abc", persisted);
    expect(after.sequence(request(18), "p").orderedAction.sequence).toBe(18);
  });

  test("stamps actor from the authenticated player and treats payload as opaque", () => {
    const payload = { actor: { type: "system" }, nested: { playerId: "spoofed" } };
    const ordered = new RoomCore("abc").sequence(request(1, payload), "trusted_player").orderedAction;
    expect(ordered.actor).toEqual({ type: "player", playerId: "trusted_player" });
    expect(ordered.action.payload).toEqual(payload);
  });

  test("sequences a system game start first and deduplicates it after rebuild", () => {
    const before = new RoomCore("abc");
    const started = before.sequenceSystem(
      { type: "system.game_start", payload: { settings: {} } },
      "game_start",
    );
    expect(started.duplicate).toBe(false);
    expect(started.orderedAction).toEqual({
      type: "ordered_action",
      protocolVersion: 1,
      sequence: 1,
      actionId: "sys_abc_game_start",
      actor: { type: "system" },
      action: { type: "system.game_start", payload: { settings: {} } },
    });

    const after = new RoomCore("abc", JSON.parse(JSON.stringify(before.state)));
    const duplicate = after.sequenceSystem(
      { type: "system.game_start", payload: { settings: { changed: true } } },
      "game_start",
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.orderedAction).toEqual(started.orderedAction);
    expect(after.state.lastSequence).toBe(1);
  });

  test("deduplicates system.timer_fire across room-core reconstruction", () => {
    const before = new RoomCore("timers");
    const fired = before.sequenceSystem(
      { type: "system.timer_fire", payload: { timerId: "timer_1" } },
      timerFireDedupKey("timer_1"),
    );
    expect(fired.duplicate).toBe(false);
    const after = new RoomCore("timers", JSON.parse(JSON.stringify(before.state)));
    const retried = after.sequenceSystem(
      { type: "system.timer_fire", payload: { timerId: "timer_1" } },
      timerFireDedupKey("timer_1"),
    );
    expect(retried.duplicate).toBe(true);
    expect(retried.orderedAction).toEqual(fired.orderedAction);
    expect(after.state.lastSequence).toBe(1);
  });

  test("timer_fire dedup keys stay bounded when a callback re-arms its own timer", () => {
    // Kernel timer ids derive from the firing action id: timer_<actionId>_<n>.
    const core = new RoomCore("abcd1234");
    let timerId = "timer_sys_abcd1234_game_start_0";
    const seen = new Set<string>();
    for (let hop = 0; hop < 200; hop += 1) {
      const key = timerFireDedupKey(timerId);
      expect(key).toMatch(/^timer_fire_[0-9a-f]{32}$/);
      expect(key).toBe(timerFireDedupKey(timerId));
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const fired = core.sequenceSystem(
        { type: "system.timer_fire", payload: { timerId } },
        key,
      );
      expect(fired.duplicate).toBe(false);
      timerId = `timer_${fired.orderedAction.actionId}_0`;
      expect(timerId.length).toBeLessThanOrEqual(256);
    }
    expect(timerFireDedupKey("timer_a")).not.toBe(timerFireDedupKey("timer_b"));
  });

  test("bootstraps the persisted room snapshot before system.game_start", () => {
    const initial = createBuiltinInitialState("builtin_dice_dash_2", [
      { playerId: "player_host", displayName: "Host" },
      { playerId: "player_guest", displayName: "Guest" },
    ])!;
    const initialSnapshot = snapshot(initial);
    const core = new RoomCore("abc");
    const gameStart = core.sequenceSystem(
      { type: "system.game_start", payload: { settings: initial.settings } },
      "game_start",
    ).orderedAction;
    const messages = roomBootstrapMessages(
      initialSnapshot,
      [
        { playerId: "player_host", displayName: "Host", seatId: "seat_1", connected: true },
        { playerId: "player_guest", displayName: "Guest", seatId: "seat_2", connected: false },
      ],
      [gameStart],
    );
    expect(messages[0]).toMatchObject({
      type: "bootstrap",
      sequence: 0,
      snapshot: initialSnapshot,
    });
    expect(messages[1]).toMatchObject({
      type: "ordered_action",
      sequence: 1,
      actor: { type: "system" },
      action: { type: "system.game_start" },
    });
  });

  test("keeps checkpoint cadence inside retention and converges after more than 500 actions", () => {
    expect(CHECKPOINT_INTERVAL).toBeLessThan(ACTION_RETENTION);
    const initialSnapshot = checkpointInitialSnapshot();
    const core = new RoomCore("checkpoint");
    let checkpoint: GameSnapshot = initialSnapshot;
    let uninterrupted = loadSnapshot(initialSnapshot);

    for (let index = 1; index <= ACTION_RETENTION + 101; index += 1) {
      const ordered = core.sequence(
        request(index, { entityId: "score", amount: 1 }, "counter.add"),
        "player_host",
      ).orderedAction;
      uninterrupted = applyOrdered(uninterrupted, ordered).state;
      if (checkpointIsDue(checkpoint.sequence, core.state.lastSequence)) {
        assertCheckpointConnectsToTail(checkpoint.sequence, core.state);
        checkpoint = replayCheckpoint(checkpoint, core.state.actions);
      }
      if (core.state.lastSequence > ACTION_RETENTION) {
        assertCheckpointConnectsToTail(checkpoint.sequence, core.state);
      }
    }

    const checkpointBootstrap = roomBootstrapFromSnapshots(
      core,
      initialSnapshot,
      checkpoint,
      [],
    );
    expect(checkpointBootstrap[0]).toMatchObject({
      type: "bootstrap",
      sequence: checkpoint.sequence,
    });
    let recovered = loadSnapshot(checkpoint);
    for (const ordered of core.state.actions.filter(
      (action) => action.sequence > checkpoint.sequence,
    )) {
      recovered = applyOrdered(recovered, ordered).state;
    }
    expect(snapshot(recovered).stateHash).toBe(snapshot(uninterrupted).stateHash);
  });

  test("uses the initial snapshot below retention and checkpoint recovery after stale resync", () => {
    const initialSnapshot = checkpointInitialSnapshot();
    const short = new RoomCore("short");
    for (let index = 1; index <= 10; index += 1) short.sequence(request(index), "player_host");
    expect(roomBootstrapFromSnapshots(short, initialSnapshot, null, [])[0]).toMatchObject({
      type: "bootstrap",
      sequence: initialSnapshot.sequence,
      snapshot: initialSnapshot,
    });

    const long = new RoomCore("long");
    let checkpoint = initialSnapshot;
    for (let index = 1; index <= ACTION_RETENTION + CHECKPOINT_INTERVAL; index += 1) {
      long.sequence(request(index), "player_host");
      if (checkpointIsDue(checkpoint.sequence, long.state.lastSequence)) {
        checkpoint = replayCheckpoint(checkpoint, long.state.actions);
      }
    }
    expect(long.resumeAfter(0)).toEqual({ type: "resync_required" });
    const recovery = roomBootstrapFromSnapshots(long, initialSnapshot, checkpoint, []);
    expect(recovery[0]).toMatchObject({ type: "bootstrap", sequence: checkpoint.sequence });
    expect(recovery.slice(1).map((message) => "sequence" in message ? message.sequence : -1))
      .toEqual(long.state.actions.filter((action) => action.sequence > checkpoint.sequence)
        .map((action) => action.sequence));
  });

  test("detects when a checkpoint base no longer connects to the retained tail", () => {
    // A room that predates checkpointing can be past the retention window
    // with only its sequence-0 initial snapshot available. That base must be
    // recognized as unusable (the DO skips checkpointing such rooms) while an
    // in-window base still connects and replays.
    const core = new RoomCore("preexisting");
    for (let index = 1; index <= ACTION_RETENTION + 30; index += 1) {
      core.sequence(request(index), "player_host");
    }
    const floor = retentionFloor(core.state);
    expect(floor).toBeGreaterThan(1);
    expect(checkpointBaseConnects(0, core.state)).toBe(false);
    expect(checkpointBaseConnects(floor - 2, core.state)).toBe(false);
    expect(checkpointBaseConnects(floor - 1, core.state)).toBe(true);
    expect(checkpointBaseConnects(core.state.lastSequence, core.state)).toBe(true);
    expect(checkpointBaseConnects(core.state.lastSequence + 1, core.state)).toBe(false);
    // The disconnected base is exactly the shape replayCheckpoint rejects.
    expect(() => replayCheckpoint(checkpointInitialSnapshot(), core.state.actions))
      .toThrow("not contiguous");

    const fresh = new RoomCore("fresh");
    for (let index = 1; index <= 10; index += 1) fresh.sequence(request(index), "player_host");
    expect(checkpointBaseConnects(0, fresh.state)).toBe(true);
  });

  test("fails loudly when an over-window bootstrap checkpoint is missing or malformed", () => {
    const initialSnapshot = checkpointInitialSnapshot();
    const core = new RoomCore("broken");
    for (let index = 1; index <= ACTION_RETENTION + 1; index += 1) {
      core.sequence(request(index), "player_host");
    }
    expect(() => roomBootstrapFromSnapshots(core, initialSnapshot, null, []))
      .toThrow("requires a checkpoint");
    expect(() => roomBootstrapFromSnapshots(core, initialSnapshot, {
      ...initialSnapshot,
      sequence: retentionFloor(core.state) - 1,
    }, [])).toThrow("metadata does not match");
  });
});

describe("scripted checkpoint attestations", () => {
  const attestation = (playerId: string, stateHash = "sha256:matching") => ({
    sequence: CHECKPOINT_INTERVAL,
    stateHash,
    snapshotJson: `{"stateHash":"${stateHash}"}`,
    playerId,
  });

  test("confirms two matching healthy players and ignores duplicate attestations", () => {
    const first = attestCheckpointCandidate(null, attestation("alice"), ["alice", "bob"]);
    expect(first.status).toBe("recorded");
    const duplicate = attestCheckpointCandidate(first.candidate, attestation("alice"), ["alice", "bob"]);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.candidate.attesters.size).toBe(1);
    const confirmed = attestCheckpointCandidate(duplicate.candidate, attestation("bob"), ["alice", "bob"]);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.candidate.attesters).toEqual(new Set(["alice", "bob"]));
  });

  test("lets the sole healthy player self-confirm", () => {
    expect(attestCheckpointCandidate(null, attestation("alice"), ["alice"]).status)
      .toBe("confirmed");
  });

  test("marks a divergent sequence conflicted and never confirms it", () => {
    const first = attestCheckpointCandidate(null, attestation("alice", "sha256:first"), ["alice", "bob"]);
    const mismatch = attestCheckpointCandidate(
      first.candidate,
      attestation("bob", "sha256:second"),
      ["alice", "bob"],
    );
    expect(mismatch.status).toBe("divergent");
    expect(mismatch.candidate.conflicted).toBe(true);
    expect(attestCheckpointCandidate(
      mismatch.candidate,
      attestation("bob", "sha256:first"),
      ["alice", "bob"],
    ).status).toBe("divergent");
  });

  test("validates attested hash, release, cadence, and retained-window sequence", () => {
    const initial = checkpointInitialSnapshot();
    const core = new RoomCore("attestation-validation");
    for (let sequence = 1; sequence <= 250; sequence += 1) {
      core.sequence(request(sequence), "alice");
    }
    const valid = snapshot({ ...loadSnapshot(initial), sequence: CHECKPOINT_INTERVAL });
    expect(() => validateCheckpointAttestationSnapshot(
      { sequence: valid.sequence, stateHash: valid.stateHash, snapshot: valid },
      valid.releaseId,
      core.state,
    )).not.toThrow();
    expect(() => validateCheckpointAttestationSnapshot(
      { sequence: valid.sequence, stateHash: valid.stateHash, snapshot: valid },
      "another_release",
      core.state,
    )).toThrow("does not match the room");
    const badHash = { ...valid, stateHash: `sha256:${"0".repeat(64)}` };
    expect(() => validateCheckpointAttestationSnapshot(
      { sequence: badHash.sequence, stateHash: badHash.stateHash, snapshot: badHash },
      valid.releaseId,
      core.state,
    )).toThrow("hash");
    expect(() => validateCheckpointAttestationSnapshot(
      {
        sequence: CHECKPOINT_INTERVAL + 1,
        stateHash: valid.stateHash,
        snapshot: { ...valid, sequence: CHECKPOINT_INTERVAL + 1 },
      },
      valid.releaseId,
      core.state,
    )).toThrow("cadence");

    const stale = new RoomCore("attestation-stale");
    for (let sequence = 1; sequence <= ACTION_RETENTION + CHECKPOINT_INTERVAL + 1; sequence += 1) {
      stale.sequence(request(sequence), "alice");
    }
    expect(() => validateCheckpointAttestationSnapshot(
      { sequence: valid.sequence, stateHash: valid.stateHash, snapshot: valid },
      valid.releaseId,
      stale.state,
    )).toThrow("outside the retained window");
  });

  test("selects initial, then attested, then full-log fallback for scripted rooms", () => {
    const initialState = createInitialState({
      releaseId: "release_scripted_checkpoint",
      rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
      entities: {
        rules: {
          id: "rules",
          components: {
            script: { scriptId: "scripts/game.lua", bindingId: "rules", props: {} },
          },
        },
      },
    });
    const initial = snapshot(initialState);
    const short = new RoomCore("scripted-short");
    const shortActions = [short.sequence(request(1), "alice").orderedAction];
    expect(roomBootstrapFromSnapshots(short, initial, null, [], {
      scripted: true,
      fullActions: shortActions,
    })[0]).toMatchObject({ type: "bootstrap", sequence: 0 });

    const long = new RoomCore("scripted-long");
    const allActions = [];
    for (let sequence = 1; sequence <= ACTION_RETENTION + 1; sequence += 1) {
      allActions.push(long.sequence(request(sequence), "alice").orderedAction);
    }
    const fallback = roomBootstrapFromSnapshots(long, initial, null, [], {
      scripted: true,
      fullActions: allActions,
    });
    expect(fallback[0]).toMatchObject({ type: "bootstrap", sequence: 0 });
    expect(fallback).toHaveLength(ACTION_RETENTION + 2);

    const checkpoint = snapshot({ ...initialState, sequence: CHECKPOINT_INTERVAL * 2 });
    const attested = roomBootstrapFromSnapshots(long, initial, checkpoint, [], {
      scripted: true,
      fullActions: allActions,
    });
    expect(attested[0]).toMatchObject({
      type: "bootstrap",
      sequence: CHECKPOINT_INTERVAL * 2,
      snapshot: checkpoint,
    });
    expect(attested).toHaveLength(1 + long.state.lastSequence - checkpoint.sequence);
  });
});
