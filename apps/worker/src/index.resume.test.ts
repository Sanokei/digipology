import { Database, type SQLQueryBindings } from "bun:sqlite";
import { expect, mock, test } from "bun:test";
import { applyOrdered, applyOrderedWithScripts, createInitialState, snapshot, type JsonValue, type OrderedActionInput } from "digipology-kernel";
import { getBuiltinRelease } from "digipology-demo-games";
import { createCreatorScriptRuntime, scriptsFromReleaseFiles } from "../../../packages/lua/src/creator-runtime";
import { createBuiltinInitialState } from "./initial-state";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}));
const { RoomDO } = await import("./index");

// Exercise the actual DO methods and migration SQL, with an in-memory SQLite
// adapter. Network lifecycle/hibernation still needs the local Wrangler smoke.
function harness(db = new Database(":memory:")) {
  const sockets: WebSocket[] = [];
  const ctx = {
    storage: {
      sql: { exec(query: string, ...args: SQLQueryBindings[]) {
        if (args.length === 0 && query.trim().split(";").filter((s) => s.trim()).length > 1) {
          db.exec(query);
          return { toArray: () => [], one: () => { throw new Error("No row"); } };
        }
        const rows = db.query(query).all(...args);
        return { toArray: () => rows, one: () => {
          if (rows.length !== 1) throw new Error(`Expected one row: ${query}`);
          return rows[0];
        } };
      } },
      transactionSync<T>(fn: () => T): T { return db.transaction(fn)(); },
      setAlarm: async () => {}, deleteAlarm: async () => {},
    },
    getWebSockets: () => sockets, waitUntil: (_promise: Promise<unknown>) => {},
  };
  const statement = { bind: (..._args: unknown[]) => statement, run: async () => ({}) };
  const room = new RoomDO(ctx as unknown as DurableObjectState, { DB: { prepare: () => statement } } as unknown as Env);
  return { db, room, sockets };
}

async function join(room: InstanceType<typeof RoomDO>, name: string) {
  const result = await room.join(name);
  if (result.status !== "ok") throw new Error(result.status);
  return result;
}

// Private entry points are called only to model hello/bootstrap without a fake
// WebSocket implementation; all sequencing, persistence and migration are real.
function internals(room: InstanceType<typeof RoomDO>) {
  return room as unknown as {
    startIfNeeded(): Promise<void>;
    players(): { playerId: string; seatId?: string; host?: boolean }[];
    authenticateRoomToken(token: string): Promise<string | null>;
    handleSocketDeparture(socket: WebSocket): Promise<void>;
  };
}

test.each(["missing", "null"])("legacy %s host backfill survives reconnect and cannot be stolen by a later join", async (column) => {
  const { db, room } = harness();
  room.init("legacy", "LEGACY", "builtin_first_deal_1", 3);
  const oldest = await join(room, "Oldest");
  await join(room, "Second");
  db.exec(column === "missing" ? "ALTER TABLE room DROP COLUMN host_player_id" : "UPDATE room SET host_player_id = NULL");
  db.exec("ALTER TABLE players DROP COLUMN seat_id");
  const reloaded = harness(db).room;
  expect(await internals(reloaded).authenticateRoomToken(oldest.roomToken)).toBe(oldest.playerId);
  expect(reloaded.hostPlayerId()).toBe(oldest.playerId);
  await join(reloaded, "Later");
  expect(reloaded.hostPlayerId()).toBe(oldest.playerId);
  expect(internals(reloaded).players().filter((p) => p.host).map((p) => p.playerId)).toEqual([oldest.playerId]);
  expect(harness(db).room.hostPlayerId()).toBe(oldest.playerId);
  expect((await reloaded.join("Full")).status).toBe("full");
  expect(reloaded.hostPlayerId()).toBe(oldest.playerId);
  // A legitimate migrated host is never overwritten by oldest-player backfill.
  db.query("UPDATE room SET host_player_id = ?").run("migrated_host");
  expect(harness(db).room.hostPlayerId()).toBe("migrated_host");
  db.close();
});

test.each([{ seatIds: ["seat_2"] }, { seatIds: Array.from({ length: 8 }, (_, i) => `seat_${i + 2}`) }])(
  "staggered joins preserve saved seat allocation: %j", async ({ seatIds }) => {
    const { db, room } = harness();
    const saved = createInitialState({ releaseId: "saved", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 } });
    for (const id of seatIds) {
      saved.players[id] = { id };
      saved.seats[id] = { id, playerId: id };
    }
    room.initFromSave("sparse", "SPARSE", "saved", 10, snapshot(saved));
    const host = await join(room, "Host");
    await internals(room).startIfNeeded();
    const sorted = [...seatIds].sort();
    // Simulate upgrading an already-started resumed Room before its late join.
    db.exec("ALTER TABLE players DROP COLUMN seat_id");
    // Reload between every arrival: allocation must survive service eviction.
    for (let i = 0; i < seatIds.length + 1; i++) await join(harness(db).room, `Guest ${i}`);
    let state = { ...saved, sequence: 0 };
    for (const row of db.query("SELECT body FROM actions ORDER BY sequence").all() as { body: string }[]) {
      const applied = applyOrdered(state, JSON.parse(row.body) as OrderedActionInput);
      expect(applied.rejection).toBeUndefined();
      state = applied.state;
    }
    expect(state.seats[sorted[0]!]!.playerId).toBe(host.playerId);
    const occupied = Object.values(state.seats).map((s) => s.playerId);
    expect(new Set(occupied).size).toBe(seatIds.length + 2);
    for (const p of internals(harness(db).room).players()) expect(state.seats[p.seatId!]!.playerId).toBe(p.playerId);
    db.close();
  },
);

test("admits ten seats end to end and rejects the eleventh", async () => {
  const { db, room } = harness();
  expect(room.init("ten", "TENSEATS", "builtin_first_deal_1", 10)).toBeTrue();
  const joined = [];
  for (let index = 1; index <= 10; index += 1) joined.push(await join(room, `Player ${index}`));
  expect(joined).toHaveLength(10);
  expect(new Set(internals(room).players().map((player) => player.playerId)).size).toBe(10);
  expect((await room.join("Player 11")).status).toBe("full");
  db.close();
});

test.each([false, true])("host-first resume restores score, turn and prompt; repeat save=%s", async (repeat) => {
  let { db, room } = harness();
  const release = getBuiltinRelease("builtin_zone_runner_2")!;
  const runtime = await createCreatorScriptRuntime({
    scripts: scriptsFromReleaseFiles(release.files),
    refs: release.refs ?? {},
    definitions: (release.definitions ?? {}) as unknown as Readonly<Record<string, JsonValue>>,
    instructionBudget: 50_000,
  });
  try {
    const initial = createBuiltinInitialState("builtin_zone_runner_2", [
      { playerId: "alice", displayName: "Alice" }, { playerId: "bob", displayName: "Bob" },
    ])!;
    const started = await applyOrderedWithScripts(initial, {
      sequence: 1, actionId: "start", actor: { type: "system" },
      action: { type: "system.game_start", payload: { settings: initial.settings } },
    }, { runtime });
    expect(started.rejection).toBeUndefined();
    let saved = { ...started.state, sequence: 0 };
    const stdlib = saved.scriptState as { __stdlib: { scores: Record<string, number>; turns: { index: number } } };
    stdlib.__stdlib.scores.bob = 7;
    stdlib.__stdlib.turns.index = 2;
    saved.prompts.returning = { id: "returning", kind: "confirm", playerId: "bob", title: "Continue?", status: "open" };
    room.initFromSave("late", "LATE", saved.releaseId, 8, snapshot(saved));
    await join(room, "Host");
    await internals(room).startIfNeeded();
    // A second save can be taken while the guest is still absent.
    if (repeat) {
      const first = db.query("SELECT body FROM actions ORDER BY sequence").get() as { body: string };
      const applied = await applyOrderedWithScripts(saved, JSON.parse(first.body) as OrderedActionInput, { runtime });
      expect(applied.rejection).toBeUndefined();
      expect(applied.state.pendingSeats?.seat_2?.player.id).toBe("bob");
      saved = { ...applied.state, sequence: 0 };
      db.close();
      ({ db, room } = harness());
      expect(room.initFromSave("again", "AGAIN", saved.releaseId, 8, snapshot(saved))).toBe(true);
      await join(room, "Host2");
      await internals(room).startIfNeeded();
    }
    // First hello already committed the host-only roster before this invitation.
    const guest = await join(harness(db).room, "Guest");
    let state = saved;
    for (const row of db.query("SELECT body FROM actions ORDER BY sequence").all() as { body: string }[]) {
      const applied = await applyOrderedWithScripts(state, JSON.parse(row.body) as OrderedActionInput, { runtime });
      expect(applied.rejection).toBeUndefined();
      state = applied.state;
    }
    const resumed = state.scriptState as { __stdlib: { scores: Record<string, number>; turns: { index: number; order: string[] } } };
    expect({ score: resumed.__stdlib.scores[guest.playerId],
      current: resumed.__stdlib.turns.order[resumed.__stdlib.turns.index - 1],
      prompt: state.prompts.returning,
    }).toEqual({ score: 7, current: guest.playerId,
      prompt: { id: "returning", kind: "confirm", playerId: guest.playerId, title: "Continue?", status: "open" },
    });
  } finally { runtime.close(); db.close(); }
});

test("unreturned seats survive disconnect and overdue alarms; replacement claim restarts timers", async () => {
  const { db, room, sockets } = harness();
  try {
    const saved = createInitialState({ releaseId: "paused", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
      players: { alice: { id: "alice" }, bob: { id: "bob" } },
      seats: { seat_1: { id: "seat_1", playerId: "alice" }, seat_2: { id: "seat_2", playerId: "bob" } },
      timers: { tick: { id: "tick", delay: 1, callback: "tick", scriptId: "rules", bindingId: "rules", status: "scheduled" } },
    });
    expect(room.initFromSave("paused", "PAUSED", saved.releaseId, 8, snapshot(saved))).toBe(true);
    const host = await join(room, "Host");
    await internals(room).startIfNeeded();
    const socket = { deserializeAttachment: () => ({ authenticated: true, playerId: host.playerId, bootstrapped: true }),
      send: (_message: string) => {}, close: () => {} } as unknown as WebSocket;
    sockets.push(socket);
    db.query("UPDATE room SET resume_pending_since = ?, last_heartbeat_at = ?").run(Date.now() - 60_000, Date.now());
    db.exec("UPDATE canonical_timers SET due_at = (SELECT resume_pending_since + 1000 FROM room)");
    await room.registerCanonicalTimer("during_pause", Date.now() + 3000);
    await room.registerCanonicalTimer("cancel_during_pause", Date.now() + 3000);
    await room.cancelCanonicalTimer("cancel_during_pause");
    await room.alarm(); // Even an overdue alarm with a connected host cannot consume the timer.
    expect(db.query("SELECT status FROM canonical_timers WHERE timer_id = 'tick'").get()).toEqual({ status: "scheduled" });
    expect(db.query("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 1 });
    sockets.length = 0;
    await internals(room).handleSocketDeparture(socket);
    expect(room.hostPlayerId()).toBe(host.playerId);
    expect(await internals(harness(db).room).authenticateRoomToken(host.roomToken)).toBe(host.playerId);
    expect(db.query("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 1 });
    // There is no auto-abandonment timeout. Any invited replacement takes the
    // reserved seat; its saved data is never reassigned just by disconnecting.
    const before = Date.now();
    const replacement = await join(harness(db).room, "Replacement");
    expect(db.query("SELECT resume_pending_since FROM room").get()).toEqual({ resume_pending_since: null });
    const timer = db.query("SELECT due_at FROM canonical_timers WHERE timer_id = 'tick'").get() as { due_at: number };
    expect(timer.due_at).toBeGreaterThanOrEqual(before + 1000);
    expect(timer.due_at).toBeLessThanOrEqual(Date.now() + 1000);
    expect((db.query("SELECT due_at FROM canonical_timers WHERE timer_id = 'during_pause'").get() as { due_at: number }).due_at)
      .toBeGreaterThanOrEqual(before + 2900);
    expect(db.query("SELECT status FROM canonical_timers WHERE timer_id = 'cancel_during_pause'").get()).toEqual({ status: "canceled" });
    const claim = db.query("SELECT body FROM actions ORDER BY sequence DESC LIMIT 1").get() as { body: string };
    expect(JSON.parse(claim.body).action).toEqual({ type: "system.seat_claim", payload: {
      playerId: replacement.playerId, name: "Replacement", seatId: "seat_2", previousPlayerId: "bob",
    } });
    // Once claimed, socket departure is transport-only. The original bearer
    // session can reconnect, and a further invite does not steal that seat.
    await internals(room).handleSocketDeparture({ ...socket,
      deserializeAttachment: () => ({ authenticated: true, playerId: replacement.playerId, bootstrapped: true }),
    } as unknown as WebSocket);
    expect(await internals(harness(db).room).authenticateRoomToken(replacement.roomToken)).toBe(replacement.playerId);
    await join(harness(db).room, "Extra");
    expect(internals(harness(db).room).players().find((p) => p.playerId === replacement.playerId)?.seatId).toBe("seat_2");
    sockets.push(socket);
    db.exec("UPDATE canonical_timers SET due_at = 0 WHERE timer_id = 'tick'");
    db.exec("UPDATE room SET last_action_at = 0");
    await room.alarm();
    await room.alarm();
    expect(db.query("SELECT status FROM canonical_timers WHERE timer_id = 'tick'").get()).toEqual({ status: "fired" });
    const actions = db.query("SELECT body FROM actions ORDER BY sequence").all() as { body: string }[];
    expect(actions.filter((row) => JSON.parse(row.body).action.type === "system.timer_fire")).toHaveLength(1);
  } finally { db.close(); }
});
