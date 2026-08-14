import { describe, expect, test } from "bun:test";
import type { ActionRequest } from "digipology-protocol";
import { createBuiltinInitialState } from "./initial-state";
import { snapshot } from "digipology-kernel";
import {
  ACTION_RETENTION,
  RoomCore,
  retentionFloor,
  roomBootstrapMessages,
} from "./room-core";

function request(index: number, payload: unknown = { index }): ActionRequest {
  return {
    type: "action_request",
    protocolVersion: 1,
    requestId: `req_${index}`,
    predictedAtSequence: Math.max(0, index - 1),
    action: { type: "test.action", payload },
  };
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
});
