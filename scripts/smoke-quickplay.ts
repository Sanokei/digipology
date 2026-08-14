// Wave-5 production smoke: kino capsule home + guest quickplay.
// Usage: bun scripts/smoke-quickplay.ts https://play.digipology.com
//
// Everything here runs as a pure guest (no session cookie):
//   1. two POST /api/quickplay calls for the same slug land in the same room,
//   2. both sockets bootstrap with server-generated Guest-XXXX names,
//   3. one ordered action converges on both clients,
//   4. /api/games reports currentPlayers > 0 while connected and an
//      incremented totalPlays after play counts flush,
//   5. the quickplay room is listed in /api/rooms/public,
//   6. builtin 2:3 covers serve immutably at the catalog-reported version,
//   7. the home page shell plus its assets carry the capsule markup.
import {
  applyOrdered,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type OrderedActionInput,
} from "digipology-kernel";
import {
  parseServerMessage,
  type ActionRequest,
  type OrderedAction,
  type PlayerInfo,
  type ServerMessage,
} from "digipology-protocol";
import type {
  GamesResponse,
  PublicRoomsResponse,
  QuickPlayResponse,
} from "digipology-protocol/http";

const NETWORK_TIMEOUT_MS = 7_000;
const PLAY_COUNT_TIMEOUT_MS = 45_000;
const MAX_FRAMES_PER_REQUEST = 20;
const SLUG = "first-deal";
const GUEST_NAME = /^Guest-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const JOIN_CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const origin = parseOrigin(Bun.argv[2] ?? "http://127.0.0.1:8787");
const sockets = new Set<WebSocket>();

let passed = 0;
let failed = 0;

interface Frame {
  raw: string;
  message: ServerMessage;
}

interface FrameWaiter {
  resolve(frame: Frame): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface Client {
  socket: WebSocket;
  next(): Promise<Frame>;
}

interface ClientPair {
  a: Client;
  b: Client;
}

interface Simulation {
  a: CanonicalGameState;
  b: CanonicalGameState;
  hash: string;
}

interface BootstrappedRoom {
  pair: ClientPair;
  simulation: Simulation;
  players: PlayerInfo[];
}

async function main(): Promise<void> {
  try {
    await runChecks();
  } finally {
    for (const socket of sockets) {
      try {
        socket.close(1000, "Smoke complete");
      } catch {
      }
    }
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  }
}

async function runChecks(): Promise<void> {
  const baseline = await check("catalog lists first-deal with metrics", async () => {
    const game = await catalogGame(SLUG);
    expect(game.builtin, `${SLUG} is not marked builtin`);
    expect(
      Number.isInteger(game.totalPlays) && game.totalPlays >= 0,
      `totalPlays is not a non-negative integer (${game.totalPlays})`,
    );
    expect(game.coverVersion !== null, `${SLUG} has no cover version`);
    return game;
  });

  const first = await check("guest quickplay creates a room", async () => {
    const response = await quickPlay(SLUG);
    expect(response.status === 200, `expected 200, received ${response.status}`);
    validateQuickPlay(response.value);
    return response.value;
  });

  const second = await check(
    "second guest quickplay joins the same room",
    async () => {
      const created = requireValue(first, "guest quickplay creates a room");
      const response = await quickPlay(SLUG);
      expect(response.status === 200, `expected 200, received ${response.status}`);
      validateQuickPlay(response.value);
      expect(
        response.value.roomId === created.roomId,
        `quickplay split the pair across rooms (${response.value.roomId} versus ${created.roomId})`,
      );
      expect(
        response.value.playerId !== created.playerId,
        "both quickplay joins received the same playerId",
      );
      return response.value;
    },
    (value) => `room ${value.joinCode}`,
  );

  const room = await check("both sockets bootstrap with Guest-XXXX names", async () => {
    const one = requireValue(first, "guest quickplay creates a room");
    const two = requireValue(second, "second guest quickplay joins the same room");
    const [a, b] = await Promise.all([connect(one.wsUrl), connect(two.wsUrl)]);
    sendHello(a.socket, one.roomToken);
    sendHello(b.socket, two.roomToken);
    const pair: ClientPair = { a, b };
    const { simulation, players } = await bootstrapSimulation(pair);
    for (const quick of [one, two]) {
      const player = players.find((candidate) => candidate.playerId === quick.playerId);
      expect(player !== undefined, `bootstrap roster is missing player ${quick.playerId}`);
      expect(
        GUEST_NAME.test(player.displayName),
        `player ${quick.playerId} has display name "${player.displayName}", expected Guest-XXXX`,
      );
    }
    return { pair, simulation, players } satisfies BootstrappedRoom;
  });

  await check("ordered entity.grab converges", async () => {
    const connected = requireValue(room, "both sockets bootstrap with Guest-XXXX names");
    const cardId = findCard(connected.simulation.a);
    expect(cardId !== undefined, "no entity has both grabbable and flippable components");
    await sendOrdered(connected.pair, connected.simulation, "entity.grab", { entityId: cardId });
  });

  await check("catalog reports currentPlayers > 0 while connected", async () => {
    requireValue(room, "both sockets bootstrap with Guest-XXXX names");
    const game = await catalogGame(SLUG);
    expect(
      game.currentPlayers > 0,
      `expected currentPlayers > 0 while connected, received ${game.currentPlayers}`,
    );
  });

  await check(
    "totalPlays increments after bootstrap",
    async () => {
      const before = requireValue(baseline, "catalog lists first-deal with metrics");
      const created = requireValue(first, "guest quickplay creates a room");
      requireValue(room, "both sockets bootstrap with Guest-XXXX names");
      // Play counts flush on the next Durable Object fetch or alarm; a
      // throwaway socket to the same room forces a flush immediately.
      const flusher = await connect(created.wsUrl);
      flusher.socket.close(1000, "flush trigger");
      const deadline = Date.now() + PLAY_COUNT_TIMEOUT_MS;
      let latest = before.totalPlays;
      while (Date.now() < deadline) {
        latest = (await catalogGame(SLUG)).totalPlays;
        if (latest > before.totalPlays) return { before: before.totalPlays, after: latest };
        await Bun.sleep(2_000);
      }
      throw new Error(
        `totalPlays stayed at ${latest} (baseline ${before.totalPlays}) after ${PLAY_COUNT_TIMEOUT_MS} ms`,
      );
    },
    (value) => `${value.before} -> ${value.after}`,
  );

  await check("quickplay room is listed in /api/rooms/public", async () => {
    const created = requireValue(first, "guest quickplay creates a room");
    const response = await getJson<PublicRoomsResponse>("/api/rooms/public");
    expect(response.status === 200, `expected 200, received ${response.status}`);
    expect(Array.isArray(response.value.rooms), "response does not contain a rooms array");
    expect(
      response.value.rooms.some((candidate) => candidate.joinCode === created.joinCode),
      `room ${created.joinCode} is absent from the public listing`,
    );
  });

  for (const slug of ["first-deal", "dice-dash"]) {
    await check(`builtin cover for ${slug} is cached and 2:3`, async () => {
      const game = await catalogGame(slug);
      expect(game.coverVersion !== null, `catalog reports no cover version for ${slug}`);
      const response = await httpRequest(`/api/games/${slug}/cover?v=${game.coverVersion}`);
      expect(response.status === 200, `cover returned ${response.status}`);
      expect(
        response.contentType.startsWith("image/"),
        `cover content-type is ${response.contentType || "<missing>"}`,
      );
      expect(
        response.cacheControl === IMMUTABLE_CACHE,
        `cover cache-control is ${response.cacheControl || "<missing>"}`,
      );
      expect(
        response.body.includes('width="336"') && response.body.includes('height="504"'),
        "cover is not the 336x504 (2:3) builtin artwork",
      );
    });
  }

  await check("home page serves the capsule markup", async () => {
    const home = await httpRequest("/");
    expect(home.status === 200, `/ returned ${home.status}`);
    expect(
      home.contentType.toLowerCase().includes("text/html"),
      `/ returned content-type ${home.contentType || "<missing>"}`,
    );
    // The home page is a SPA shell: the capsule markup ships in the bundled
    // script and stylesheet the shell references.
    const assets = [...home.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);
    expect(assets.length > 0, "home page shell references no /assets bundles");
    let bundled = "";
    for (const path of assets) {
      const asset = await httpRequest(path);
      expect(asset.status === 200, `${path} returned ${asset.status}`);
      bundled += asset.body;
    }
    for (const marker of ["game-hero", "game-rail", "game-capsule"]) {
      expect(
        bundled.includes(marker),
        `home page assets do not contain the "${marker}" capsule class`,
      );
    }
  });
}

async function catalogGame(slug: string) {
  const response = await getJson<GamesResponse>("/api/games");
  expect(response.status === 200, `/api/games returned ${response.status}`);
  expect(Array.isArray(response.value.games), "response does not contain a games array");
  const game = response.value.games.find((candidate) => candidate.slug === slug);
  expect(game !== undefined, `catalog does not list ${slug}`);
  return game;
}

async function quickPlay(slug: string): Promise<{ status: number; value: QuickPlayResponse }> {
  return postJson<QuickPlayResponse>("/api/quickplay", { slug });
}

function validateQuickPlay(value: QuickPlayResponse): void {
  expect(isRecord(value), "quickplay response is not an object");
  expect(typeof value.roomId === "string" && value.roomId.length > 0, "roomId is empty");
  expect(typeof value.playerId === "string" && value.playerId.length > 0, "playerId is empty");
  expect(typeof value.roomToken === "string" && value.roomToken.length > 0, "room token is empty");
  expect(typeof value.wsUrl === "string" && value.wsUrl.length > 0, "wsUrl is empty");
  expect(typeof value.releaseId === "string" && value.releaseId.length > 0, "releaseId is empty");
  expect(typeof value.joinCode === "string" && JOIN_CODE.test(value.joinCode), "join code is invalid");
}

async function sendOrdered(
  pair: ClientPair,
  simulation: Simulation,
  actionType: string,
  payload: unknown,
): Promise<void> {
  const request: ActionRequest = {
    type: "action_request",
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    predictedAtSequence: simulation.a.sequence,
    action: { type: actionType, payload },
  };
  pair.a.socket.send(JSON.stringify(request));
  const frameA = await applyUntilRequest(simulation, "a", pair.a, request.requestId);
  const frameB = await applyUntilRequest(simulation, "b", pair.b, request.requestId);
  expect(frameA.raw === frameB.raw, "clients received different ordered frames");

  const hashA = snapshot(simulation.a).stateHash;
  const hashB = snapshot(simulation.b).stateHash;
  expect(hashA === hashB, "kernel state hashes diverged");
  expect(hashA !== simulation.hash, "kernel state hash did not change");
  simulation.hash = hashA;
}

async function applyUntilRequest(
  simulation: Simulation,
  side: "a" | "b",
  client: Client,
  requestId: string,
): Promise<Frame> {
  const label = side.toUpperCase();
  for (let received = 0; received < MAX_FRAMES_PER_REQUEST; received += 1) {
    const frame = await client.next();
    const message = frame.message;
    expect(
      message.type === "ordered_action",
      `client ${label} expected ordered_action, received ${describeFrame(message)}`,
    );
    const expectedSequence = simulation[side].sequence + 1;
    expect(
      message.sequence === expectedSequence,
      `client ${label} expected sequence ${expectedSequence}, received ${message.sequence}`,
    );
    const result = applyOrdered(simulation[side], toKernelAction(message));
    simulation[side] = result.state;
    expect(
      result.rejection === undefined,
      `client ${label} rejected ${message.action.type}: ${result.rejection?.reason}`,
    );
    if (message.requestId === requestId) return frame;
    expect(
      message.actor.type === "system",
      `client ${label} received an unexpected player action ${message.action.type}`,
    );
  }
  throw new Error(`client ${label} never received the ordered action for request ${requestId}`);
}

async function bootstrapSimulation(
  pair: ClientPair,
): Promise<{ simulation: Simulation; players: PlayerInfo[] }> {
  const [frameA, frameB] = await Promise.all([pair.a.next(), pair.b.next()]);
  expect(
    frameA.message.type === "bootstrap",
    `client A expected bootstrap, received ${describeFrame(frameA.message)}`,
  );
  expect(
    frameB.message.type === "bootstrap",
    `client B expected bootstrap, received ${describeFrame(frameB.message)}`,
  );
  const a = loadSnapshot(frameA.message.snapshot as GameSnapshot);
  const b = loadSnapshot(frameB.message.snapshot as GameSnapshot);
  expect(
    a.sequence === frameA.message.sequence && b.sequence === frameB.message.sequence,
    "bootstrap sequence does not match its snapshot",
  );
  const hashA = snapshot(a).stateHash;
  const hashB = snapshot(b).stateHash;
  expect(hashA === hashB, "bootstrap snapshots have different hashes");
  return { simulation: { a, b, hash: hashA }, players: frameB.message.players };
}

function describeFrame(message: ServerMessage): string {
  return message.type === "protocol_error"
    ? `protocol_error: ${message.message}`
    : message.type;
}

function toKernelAction(message: OrderedAction): OrderedActionInput<unknown> {
  return {
    sequence: message.sequence,
    actionId: message.actionId,
    actor: message.actor,
    action: message.action,
  };
}

function findCard(state: CanonicalGameState): string | undefined {
  return Object.keys(state.entities)
    .filter((entityId) => {
      const components = state.entities[entityId]?.components;
      return components?.grabbable !== undefined && components.flippable !== undefined;
    })
    .sort(compareStrings)[0];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface HttpResponse {
  status: number;
  contentType: string;
  cacheControl: string;
  body: string;
}

async function getJson<T>(path: string): Promise<{ status: number; value: T }> {
  const response = await httpRequest(path);
  return { status: response.status, value: parseJson<T>(path, response.body) };
}

async function postJson<T>(path: string, body: object): Promise<{ status: number; value: T }> {
  const response = await httpRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Digipology-CSRF": "1" },
    body: JSON.stringify(body),
  });
  return { status: response.status, value: parseJson<T>(path, response.body) };
}

async function httpRequest(
  path: string,
  init: Omit<RequestInit, "signal"> = {},
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}${path}`, { ...init, signal: controller.signal });
    const body = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      cacheControl: response.headers.get("cache-control") ?? "",
      body,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${init.method ?? "GET"} ${path} timed out after ${NETWORK_TIMEOUT_MS} ms`);
    }
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${errorDetail(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson<T>(path: string, body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
}

async function connect(wsUrl: string): Promise<Client> {
  const socket = new WebSocket(wsUrl);
  const frames: Frame[] = [];
  const waiters: FrameWaiter[] = [];
  let failure: Error | null = null;

  const push = (frame: Frame): void => {
    const waiter = waiters.shift();
    if (waiter === undefined) {
      frames.push(frame);
      return;
    }
    clearTimeout(waiter.timeout);
    waiter.resolve(frame);
  };
  const fail = (error: Error): void => {
    if (failure === null) failure = error;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  };

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      fail(new Error("Expected a text WebSocket frame"));
      return;
    }
    const parsed = parseServerMessage(event.data);
    if (!parsed.ok) {
      fail(new Error(`Invalid server message: ${parsed.error.detail}`));
      return;
    }
    push({ raw: event.data, message: parsed.message });
  });
  socket.addEventListener("error", () => fail(new Error("WebSocket failed")));
  socket.addEventListener("close", () => fail(new Error("WebSocket closed")));

  await opened(socket);
  sockets.add(socket);
  socket.addEventListener("close", () => sockets.delete(socket), { once: true });

  return {
    socket,
    next(): Promise<Frame> {
      const queued = frames.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      if (failure !== null) return Promise.reject(failure);
      return new Promise<Frame>((resolve, reject) => {
        const waiter: FrameWaiter = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(
              new Error(`Timed out waiting for WebSocket message after ${NETWORK_TIMEOUT_MS} ms`),
            );
          }, NETWORK_TIMEOUT_MS),
        };
        waiters.push(waiter);
      });
    },
  };
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error(`WebSocket open timed out after ${NETWORK_TIMEOUT_MS} ms`));
    }, NETWORK_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("WebSocket connection failed"));
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("WebSocket closed before opening"));
    };
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

function sendHello(socket: WebSocket, sessionToken: string): void {
  socket.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    sessionToken,
    lastSequence: null,
  }));
}

async function check<T>(
  name: string,
  action: () => Promise<T>,
  detail?: (value: T) => string,
): Promise<T | undefined> {
  try {
    const value = await action();
    const suffix = detail === undefined ? "" : `: ${detail(value)}`;
    console.log(`PASS ${name}${suffix}`);
    passed += 1;
    return value;
  } catch (error) {
    console.error(`FAIL ${name}: ${errorDetail(error)}`);
    failed += 1;
    return undefined;
  }
}

function requireValue<T>(value: T | undefined, checkName: string): T {
  if (value === undefined) throw new Error(`prerequisite failed: ${checkName}`);
  return value;
}

function expect(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("origin must use http or https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("origin must not contain credentials");
  }
  return parsed.origin;
}

main().catch((error: unknown) => {
  console.error(`FAIL smoke run: ${errorDetail(error)}`);
  process.exitCode = 1;
});
