import { parseServerMessage, type ServerMessage } from "digipology-protocol";
import type {
  CreateRoomResponse,
  GamesResponse,
  JoinRoomResponse,
} from "digipology-protocol/http";

const baseUrl = (Bun.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function main(): Promise<void> {
  const catalog = await getJson<GamesResponse>("/api/games");
  const game = catalog.games[0];
  if (game === undefined) throw new Error("Built-in catalog is empty");
  pass("catalog", game.builtin && game.maxPlayers >= 2);

  const created = await jsonRequest<CreateRoomResponse>("/api/rooms", {
    releaseSlugOrId: game.slug,
    visibility: "private",
    displayName: "Alice",
  });
  pass("create + pin release", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(created.joinCode));
  const bob = await join(` ${created.joinCode.toLowerCase().replace("-", " - ")} `, "Bob");
  pass("D1 code lookup + normalization", created.roomId === bob.roomId && bob.releaseId.length > 0);

  const a = await connect(created.wsUrl);
  const b = await connect(bob.wsUrl);
  const startMessagesA = nextMany(a, 2);
  const startMessagesB = nextMany(b, 2);
  a.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: created.roomToken, lastSequence: null }));
  b.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: bob.roomToken, lastSequence: null }));
  const [bootstrapA, gameStartA] = await startMessagesA;
  const [bootstrapB, gameStartB] = await startMessagesB;
  pass("two WebSocket hellos", bootstrapA?.type === "bootstrap" && bootstrapB?.type === "bootstrap");
  pass(
    "system game start",
    gameStartA?.type === "ordered_action" &&
      gameStartB?.type === "ordered_action" &&
      gameStartA.sequence === 1 &&
      gameStartA.actor.type === "system" &&
      JSON.stringify(gameStartA) === JSON.stringify(gameStartB),
  );

  const action = { type: "action_request", protocolVersion: 1, requestId: "smoke_req_1", predictedAtSequence: 1, action: { type: "entity.grab", payload: { entityId: "ent_red_pawn" } } };
  const orderedAPromise = next(a);
  const orderedBPromise = next(b);
  a.send(JSON.stringify(action));
  const orderedA = await orderedAPromise;
  const orderedB = await orderedBPromise;
  pass("shared ordered action", JSON.stringify(orderedA) === JSON.stringify(orderedB) && orderedA.type === "ordered_action" && orderedA.sequence === 2);

  const duplicatePromise = next(a);
  a.send(JSON.stringify(action));
  const duplicate = await duplicatePromise;
  pass("duplicate mapping", JSON.stringify(duplicate) === JSON.stringify(orderedA));

  a.close();
  const reconnected = await connect(created.wsUrl);
  const resumePromise = next(reconnected);
  reconnected.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: created.roomToken, lastSequence: 1 }));
  const resume = await resumePromise;
  pass("reconnect resume", resume.type === "resume" && resume.fromSequence === 2 && resume.actions.length === 1);

  for (let index = 3; index <= game.maxPlayers; index += 1) {
    await join(created.joinCode, `Player ${index}`);
  }
  const fullResponse = await fetch(`${baseUrl}/api/rooms/join`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ code: created.joinCode, displayName: `Player ${game.maxPlayers + 1}` }),
  });
  const fullBody = await fullResponse.json() as { error?: { code?: string } };
  pass("room capacity", fullResponse.status === 409 && fullBody.error?.code === "full");
  reconnected.close();
  b.close();
}

async function join(code: string, displayName: string): Promise<JoinRoomResponse> {
  return jsonRequest<JoinRoomResponse>("/api/rooms/join", { code, displayName });
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function jsonRequest<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function apiHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", "X-Digipology-CSRF": "1" };
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

async function nextMany(socket: WebSocket, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket messages")), 5_000);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        clearTimeout(timeout);
        reject(new Error("Expected a text frame"));
        return;
      }
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        clearTimeout(timeout);
        reject(new Error(parsed.error.detail));
        return;
      }
      messages.push(parsed.message);
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
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
