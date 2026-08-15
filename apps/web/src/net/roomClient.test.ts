import { describe, expect, it } from "bun:test";
import { createInitialState, snapshot } from "digipology-kernel";

import { createApiClient } from "../api/client";
import { KernelStore } from "../state/kernelStore";
import { RoomClient } from "./roomClient";

class MockSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  open() { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event("open")); }
  message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  close() { this.readyState = WebSocket.CLOSED; this.dispatchEvent(new CloseEvent("close")); }
}

const session = { roomId: "room", joinCode: "ABCD-EFGH", inviteUrl: "https://play.digipology.com/join/ABCD-EFGH", playerId: "p1", roomToken: "token", wsUrl: "wss://example.test/ws", releaseId: "release_test", gameTitle: "Test" };

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for RoomClient state");
}

describe("RoomClient", () => {
  it("loads the release, sends hello, and submits unpredicted actions", async () => {
    const initial = createInitialState({ releaseId: "release_test", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 } });
    const api = createApiClient(async () => Response.json({ releaseId: "release_test", initialSnapshot: snapshot(initial) }));
    const socket = new MockSocket(); const statuses: string[] = []; const store = new KernelStore();
    const client = new RoomClient(session, store, (status) => statuses.push(status.state), api, () => socket as unknown as WebSocket);
    client.start(); socket.open(); await new Promise((resolve) => setTimeout(resolve, 10));
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ type: "hello", sessionToken: "token", lastSequence: null });
    socket.message({ type: "bootstrap", protocolVersion: 1, sequence: 0, players: [] });
    const requestId = client.sendAction({ type: "counter.add", payload: { entityId: "counter", amount: 1 } });
    expect(requestId).toBeString();
    expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({ type: "action_request", predictedAtSequence: 0 });
    expect(statuses).toEqual(["connecting", "loading_release", "starting", "connected"]);
    client.stop();
  });

  it("never skips an ordered sequence gap", async () => {
    const initial = createInitialState({ releaseId: "release_test", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 } });
    const api = createApiClient(async () => Response.json({ releaseId: "release_test", initialSnapshot: snapshot(initial) }));
    const socket = new MockSocket(); const statuses: string[] = []; const store = new KernelStore();
    const client = new RoomClient(session, store, (status) => statuses.push(status.state), api, () => socket as unknown as WebSocket);
    client.start(); socket.open(); await new Promise((resolve) => setTimeout(resolve, 10));
    socket.message({ type: "bootstrap", protocolVersion: 1, sequence: 0, players: [] });
    socket.message({ type: "ordered_action", protocolVersion: 1, sequence: 2, actionId: "a2", actor: { type: "system" }, action: { type: "system.game_start", payload: {} } });
    expect(store.getSnapshot().state?.sequence).toBe(0);
    expect(store.getSnapshot().diagnostic).toContain("gap");
    expect(statuses.at(-1)).toBe("reconnecting");
    client.stop();
  });

  it("predicts grab immediately, leaves die.roll unpredicted, and does not send a local rejection", async () => {
    const initial = createInitialState({
      releaseId: "release_test",
      rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
      entities: {
        token: { id: "token", components: { transform: { position: { x: 0, y: 0.1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, grabbable: { enabled: true, heldBy: null } } },
        die: { id: "die", components: { transform: { position: { x: 1, y: 0.1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, die: { definitionId: "standard_d6", value: 1 } } },
      },
    });
    const api = createApiClient(async () => Response.json({ releaseId: "release_test", initialSnapshot: snapshot(initial) }));
    const socket = new MockSocket(); const store = new KernelStore();
    const client = new RoomClient(session, store, () => {}, api, () => socket as unknown as WebSocket);
    client.start(); socket.open(); await new Promise((resolve) => setTimeout(resolve, 10));
    socket.message({ type: "bootstrap", protocolVersion: 1, sequence: 0, players: [{ playerId: "p1", displayName: "Alice", seatId: null, connected: true }] });

    const confirmedBeforeRoll = store.getSnapshot().state;
    expect(client.sendAction({ type: "die.roll", payload: { entityId: "die" } })).toBeString();
    expect(store.getSnapshot().state).toBe(confirmedBeforeRoll);
    expect(store.getSnapshot().displayedState?.entities.die?.components.die?.value).toBe(1);
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);

    expect(client.sendAction({ type: "entity.grab", payload: { entityId: "token" } })).toBeString();
    expect(store.getSnapshot().state?.entities.token?.components.grabbable?.heldBy).toBeNull();
    expect(store.getSnapshot().displayedState?.entities.token?.components.grabbable?.heldBy).toBe("p1");
    expect(store.getSnapshot().predictionLedger).toHaveLength(1);
    const sentBeforeInvalid = socket.sent.length;
    expect(client.sendAction({ type: "entity.grab", payload: { entityId: "token" } })).toBeNull();
    expect(socket.sent).toHaveLength(sentBeforeInvalid);
    expect(store.getSnapshot().predictionLedger).toHaveLength(1);
    client.stop();
  });

  it("drops an in-flight prediction as soon as its socket dies, before reconnect hello", async () => {
    const initial = createInitialState({
      releaseId: "release_test",
      rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
      entities: {
        token: { id: "token", components: { transform: { position: { x: 0, y: 0.1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, grabbable: { enabled: true, heldBy: null } } },
      },
    });
    const api = createApiClient(async () => Response.json({ releaseId: "release_test", initialSnapshot: snapshot(initial) }));
    const socket = new MockSocket(); const statuses: string[] = []; const store = new KernelStore();
    const client = new RoomClient(session, store, (status) => statuses.push(status.state), api, () => socket as unknown as WebSocket);
    client.start(); socket.open(); await new Promise((resolve) => setTimeout(resolve, 10));
    socket.message({ type: "bootstrap", protocolVersion: 1, sequence: 0, players: [{ playerId: "p1", displayName: "Alice", seatId: null, connected: true }] });
    expect(client.sendAction({ type: "entity.grab", payload: { entityId: "token" } })).toBeString();
    expect(store.getSnapshot().displayedState?.entities.token?.components.grabbable?.heldBy).toBe("p1");

    socket.close();

    expect(statuses.at(-1)).toBe("reconnecting");
    expect(store.getSnapshot().predictionLedger).toHaveLength(0);
    expect(store.getSnapshot().pendingRequestIds.size).toBe(0);
    expect(store.getSnapshot().displayedState?.entities.token?.components.grabbable?.heldBy).toBeNull();
    expect(store.getSnapshot().correction).not.toBeNull();
    client.stop();
  });

  it("runs release Lua for ordered live actions and reports canonical timer metadata", async () => {
    const initial = createInitialState({
      releaseId: "release_test",
      rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
      players: { p1: { id: "p1", name: "Alice" } },
      seats: { seat_1: { id: "seat_1", playerId: "p1" } },
      entities: {
        rules: { id: "rules", components: { script: { scriptId: "scripts/game.lua", bindingId: "rules", props: {} } } },
        score: { id: "score", components: { counter: { value: 0, default: 0, min: 0, max: 10 } } },
      },
    });
    const source = `function on_start(ctx)
  ui:confirm(players:get("p1"), { id = "ready", title = "Ready?" })
  timer:after(2, "timeout")
end
function on_prompt(ctx)
  if ctx.response then refs.score:add(1) end
end
function timeout(ctx) refs.score:add(2) end
return {}`;
    const bundle = {
      releaseId: "release_test",
      initialSnapshot: snapshot(initial),
      files: [{ path: "scripts/game.lua", content: source, byteLength: source.length, contentHash: `sha256:${"0".repeat(64)}` }],
      refs: { score: "score" },
    };
    const api = createApiClient(async () => Response.json(bundle));
    const socket = new MockSocket();
    const store = new KernelStore();
    const timers: Array<{ operation: string; timerId: string; delay?: number }> = [];
    const client = new RoomClient(
      session,
      store,
      () => undefined,
      api,
      () => socket as unknown as WebSocket,
      async (input) => { timers.push(input); },
    );
    client.start();
    socket.open();
    await waitFor(() => socket.sent.length > 0);
    socket.message({ type: "bootstrap", protocolVersion: 1, sequence: 0, players: [] });
    socket.message({
      type: "ordered_action", protocolVersion: 1, sequence: 1, actionId: "start",
      actor: { type: "system" }, action: { type: "system.game_start", payload: { settings: {} } },
    });
    await waitFor(() => store.getSnapshot().state?.prompts.ready?.status === "open");
    expect(store.getSnapshot().state?.prompts.ready?.status).toBe("open");
    expect(timers).toEqual([{ operation: "register", timerId: "timer_start_0", delay: 2 }]);

    socket.message({
      type: "ordered_action", protocolVersion: 1, sequence: 2, actionId: "respond",
      requestId: "request-ready", actor: { type: "player", playerId: "p1" },
      action: { type: "prompt.respond", payload: { promptId: "ready", response: true } },
    });
    await waitFor(() => store.getSnapshot().state?.sequence === 2);
    expect(store.getSnapshot().state?.entities.score?.components.counter?.value).toBe(1);
    client.stop();
  }, 20_000);
});
