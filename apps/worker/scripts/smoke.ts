import { parseServerMessage, type ServerMessage } from "digipology-protocol";

const baseUrl = (Bun.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function main(): Promise<void> {
  const created = await jsonRequest<{ roomId: string; joinCode: string; wsUrl: string }>("/api/rooms", {});
  pass("create", created.joinCode.length === 7);
  const alice = await join(created.joinCode, "Alice");
  const bob = await join(` ${created.joinCode.toLowerCase()} `, "Bob");
  pass("join + normalization", alice.roomId === bob.roomId);

  const a = await connect(alice.wsUrl);
  const b = await connect(bob.wsUrl);
  const bootstrapA = next(a);
  const bootstrapB = next(b);
  a.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: alice.sessionToken, lastSequence: null }));
  b.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: bob.sessionToken, lastSequence: null }));
  pass("two bootstraps", (await bootstrapA).type === "bootstrap" && (await bootstrapB).type === "bootstrap");

  const action = { type: "action_request", protocolVersion: 1, requestId: "smoke_req_1", predictedAtSequence: 0, action: { type: "entity.grab", payload: { entityId: "ent_red_pawn" } } };
  const orderedAPromise = next(a);
  const orderedBPromise = next(b);
  a.send(JSON.stringify(action));
  const orderedA = await orderedAPromise;
  const orderedB = await orderedBPromise;
  pass("shared ordered action", JSON.stringify(orderedA) === JSON.stringify(orderedB) && orderedA.type === "ordered_action" && orderedA.sequence === 1);

  const duplicatePromise = next(a);
  a.send(JSON.stringify(action));
  const duplicate = await duplicatePromise;
  pass("duplicate mapping", JSON.stringify(duplicate) === JSON.stringify(orderedA));

  a.close();
  const reconnected = await connect(alice.wsUrl);
  const resumePromise = next(reconnected);
  reconnected.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: alice.sessionToken, lastSequence: 0 }));
  const resume = await resumePromise;
  pass("reconnect resume", resume.type === "resume" && resume.fromSequence === 1 && resume.actions.length === 1);

  for (let index = 3; index <= 8; index += 1) {
    await join(created.joinCode, `Player ${index}`);
  }
  const fullResponse = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ joinCode: created.joinCode, displayName: "Player 9" }),
  });
  pass("room capacity", fullResponse.status === 409);
  reconnected.close();
  b.close();
}

async function join(joinCode: string, displayName: string) {
  return jsonRequest<{ roomId: string; playerId: string; sessionToken: string; wsUrl: string }>("/api/rooms/join", { joinCode, displayName });
}

async function jsonRequest<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function connect(wsUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket connection failed: ${wsUrl}`)), { once: true });
  });
  return socket;
}

async function next(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 5_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      if (typeof event.data !== "string") return reject(new Error("Expected a text frame"));
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) return reject(new Error(parsed.error.detail));
      resolve(parsed.message);
    }, { once: true });
  });
}

function pass(name: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
