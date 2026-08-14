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
});
