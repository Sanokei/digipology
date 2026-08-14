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
  type ServerMessage,
} from "digipology-protocol";
import type {
  ApiErrorResponse,
  CreateRoomResponse,
  GamesResponse,
  JoinRoomResponse,
  MeResponse,
  PublicRoomsResponse,
} from "digipology-protocol/http";

const NETWORK_TIMEOUT_MS = 7_000;
const MAX_FRAMES_PER_REQUEST = 20;
const JOIN_CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const origin = parseOrigin(Bun.argv[2] ?? "http://127.0.0.1:8787");
const sockets = new Set<WebSocket>();

let passed = 0;
let failed = 0;
let skipped = 0;

interface HttpResponse {
  status: number;
  contentType: string;
  body: string;
}

interface Frame {
  raw: string;
  message: ServerMessage;
}

interface FrameWaiter {
  resolve(frame: Frame): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

/** A connected room socket whose incoming frames are queued losslessly. */
interface Client {
  socket: WebSocket;
  next(): Promise<Frame>;
}

interface ClientPair {
  a: Client;
  b: Client;
}

interface ConnectedRoom {
  pair: ClientPair;
  simulation: Simulation;
}

interface Simulation {
  a: CanonicalGameState;
  b: CanonicalGameState;
  hash: string;
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
    console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed > 0) process.exitCode = 1;
  }
}

async function runChecks(): Promise<void> {
  await check("unauthenticated /api/me", async () => {
    const response = await getJson<MeResponse>("/api/me");
    expect(response.status === 200, `expected 200, received ${response.status}`);
    expect(
      isRecord(response.value) &&
        response.value.user === null &&
        Object.keys(response.value).length === 1,
      "expected body {\"user\":null}",
    );
  });

  await check("games catalog", async () => {
    const response = await getJson<GamesResponse>("/api/games");
    expect(response.status === 200, `expected 200, received ${response.status}`);
    expect(Array.isArray(response.value.games), "response does not contain a games array");
    for (const slug of ["first-deal", "dice-dash"]) {
      const game = response.value.games.find((candidate) => candidate.slug === slug);
      expect(game !== undefined, `catalog does not list ${slug}`);
      expect(game.builtin === true, `${slug} is not marked builtin`);
      expect(
        Number.isInteger(game.minPlayers) &&
          Number.isInteger(game.maxPlayers) &&
          game.minPlayers >= 2 &&
          game.minPlayers <= game.maxPlayers,
        `${slug} has invalid player limits`,
      );
    }
  });

  await check("spa fallback", async () => {
    for (const path of ["/", "/join/AAAA-2222"]) {
      const response = await httpRequest(path);
      expect(response.status === 200, `${path} returned ${response.status}`);
      expect(
        response.contentType.toLowerCase().includes("text/html"),
        `${path} returned content-type ${response.contentType || "<missing>"}`,
      );
    }
  });

  const firstCreated = await check("create private room", async () => {
    const response = await createRoom("first-deal", "private", "Smoke Alice");
    expect(response.status === 201, `expected 201, received ${response.status}`);
    validateCreatedRoom(response.value);
    return response.value;
  });

  const firstJoined = await check("guest join via code", async () => {
    const created = requireValue(firstCreated, "create private room");
    const scrambled = ` ${created.joinCode.toLowerCase().replace("-", " - ")} `;
    const response = await joinRoom(scrambled, "Smoke Bob");
    expect(response.status === 200, `expected 200, received ${response.status}`);
    validateJoinedRoom(response.value);
    expect(response.value.roomId === created.roomId, "join returned a different roomId");
    expect(response.value.releaseId.length > 0, "join returned an empty releaseId");
    return response.value;
  });

  const firstRoom = await check("websocket handshake x2", async () => {
    const created = requireValue(firstCreated, "create private room");
    const joined = requireValue(firstJoined, "guest join via code");
    const [a, b] = await Promise.all([connect(created.wsUrl), connect(joined.wsUrl)]);
    sendHello(a.socket, created.roomToken);
    sendHello(b.socket, joined.roomToken);
    const pair: ClientPair = { a, b };
    const simulation = await bootstrapSimulation(pair);
    return { pair, simulation } satisfies ConnectedRoom;
  });

  await check("release bundle snapshot", async () => {
    const joined = requireValue(firstJoined, "guest join via code");
    await validateReleaseBundle(joined.releaseId);
  });

  let cardId: string | undefined;
  if (firstRoom !== undefined) cardId = findCard(firstRoom.simulation.a);

  await orderedCheck("entity.grab", { entityId: cardId }, firstRoom);
  await orderedCheck("entity.flip", { entityId: cardId }, firstRoom);
  await orderedCheck(
    "entity.drop",
    {
      entityId: cardId,
      transform: {
        position: { x: 1, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
    firstRoom,
  );

  await check(
    "die roll converges",
    async () => {
      const createdResponse = await createRoom("dice-dash", "private", "Smoke Dice Alice");
      expect(createdResponse.status === 201, `create returned ${createdResponse.status}`);
      validateCreatedRoom(createdResponse.value);
      const created = createdResponse.value;

      const scrambled = ` ${created.joinCode.toLowerCase().replace("-", " - ")} `;
      const joinedResponse = await joinRoom(scrambled, "Smoke Dice Bob");
      expect(joinedResponse.status === 200, `join returned ${joinedResponse.status}`);
      validateJoinedRoom(joinedResponse.value);
      expect(joinedResponse.value.roomId === created.roomId, "join returned a different roomId");

      const [a, b] = await Promise.all([
        connect(created.wsUrl),
        connect(joinedResponse.value.wsUrl),
      ]);
      sendHello(a.socket, created.roomToken);
      sendHello(b.socket, joinedResponse.value.roomToken);
      const pair: ClientPair = { a, b };
      const simulation = await bootstrapSimulation(pair);

      const dieId = findDie(simulation.a);
      expect(dieId !== undefined, "no entity has a die component");
      await sendOrdered(pair, simulation, "die.roll", { entityId: dieId });
      const valueA = rolledValue(simulation.a, dieId);
      const valueB = rolledValue(simulation.b, dieId);
      expect(valueA === valueB, `clients disagree on rolled value (${valueA} versus ${valueB})`);
      return valueA;
    },
    (value) => `rolled ${value}`,
  );

  await check("public rooms listing", async () => {
    const response = await getJson<PublicRoomsResponse>("/api/rooms/public");
    expect(response.status === 200, `expected 200, received ${response.status}`);
    expect(Array.isArray(response.value.rooms), "response does not contain a rooms array");
  });

  await check("public room auth gate", async () => {
    const response = await createRoom("first-deal", "public", "Smoke Anonymous");
    expect(response.status === 401, `expected 401, received ${response.status}`);
    const body = response.value as CreateRoomResponse | ApiErrorResponse;
    expect(
      isRecord(body) &&
        isRecord(body.error) &&
        body.error.code === "authentication_required",
      "expected authentication_required error",
    );
  });

  const session = Bun.env.SMOKE_SESSION;
  if (session === undefined) {
    skip("authenticated public room", "set SMOKE_SESSION to run");
  } else {
    await check("authenticated public room", async () => {
      const response = await createRoom(
        "first-deal",
        "public",
        "Smoke Public Host",
        { Cookie: `dgp_session=${session}` },
      );
      expect(response.status === 201, `expected 201, received ${response.status}`);
      validateCreatedRoom(response.value);
      const listing = await getJson<PublicRoomsResponse>("/api/rooms/public");
      expect(listing.status === 200, `listing returned ${listing.status}`);
      expect(
        Array.isArray(listing.value.rooms) &&
          listing.value.rooms.some((room) => room.joinCode === response.value.joinCode),
        "new public room is absent from the public listing",
      );
    });
  }
}

async function orderedCheck(
  actionType: string,
  payload: unknown,
  room: ConnectedRoom | undefined,
): Promise<void> {
  await check(`ordered ${actionType}`, async () => {
    const connected = requireValue(room, "websocket handshake x2");
    if (isRecord(payload) && payload.entityId === undefined) {
      throw new Error("no entity has both grabbable and flippable components");
    }
    await sendOrdered(connected.pair, connected.simulation, actionType, payload);
  });
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

/**
 * Applies every broadcast ordered action (including system-sequenced ones such
 * as system.game_start) to one client's simulation, in arrival order, until
 * the action produced by the given request arrives. Sequence contiguity is
 * asserted against the local simulation rather than against absolute numbers,
 * because the room log legitimately begins with system actions.
 */
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

async function bootstrapSimulation(pair: ClientPair): Promise<Simulation> {
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
  return { a, b, hash: hashA };
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

async function validateReleaseBundle(releaseId: string): Promise<void> {
  const response = await getJson<unknown>(
    `/api/releases/${encodeURIComponent(releaseId)}/bundle`,
  );
  expect(response.status === 200, `bundle returned ${response.status}`);
  expect(isRecord(response.value), "release bundle is not an object");
  const candidate = response.value.initialSnapshot;
  expect(isRecord(candidate), "release bundle does not contain initialSnapshot");
  const a = loadSnapshot(candidate as unknown as GameSnapshot);
  const b = loadSnapshot(candidate as unknown as GameSnapshot);
  expect(a.sequence === 0 && b.sequence === 0, "initial snapshot sequence is not 0");
  const hashA = snapshot(a).stateHash;
  const hashB = snapshot(b).stateHash;
  expect(hashA === hashB, "independently loaded snapshots have different hashes");
}

function findCard(state: CanonicalGameState): string | undefined {
  return Object.keys(state.entities)
    .filter((entityId) => {
      const components = state.entities[entityId]?.components;
      return components?.grabbable !== undefined && components.flippable !== undefined;
    })
    .sort(compareStrings)[0];
}

function findDie(state: CanonicalGameState): string | undefined {
  return Object.keys(state.entities)
    .filter((entityId) => state.entities[entityId]?.components.die !== undefined)
    .sort(compareStrings)[0];
}

function rolledValue(state: CanonicalGameState, dieId: string): number {
  const die = state.entities[dieId]?.components.die;
  expect(die !== undefined, `${dieId} does not have a die component`);
  const value = die.value;
  expect(
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6,
    `die ${dieId} does not contain an integer value from 1 to 6`,
  );
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function createRoom(
  releaseSlugOrId: string,
  visibility: "private" | "public",
  displayName: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; value: CreateRoomResponse }> {
  return postJson<CreateRoomResponse>(
    "/api/rooms",
    { releaseSlugOrId, visibility, displayName },
    extraHeaders,
  );
}

async function joinRoom(
  code: string,
  displayName: string,
): Promise<{ status: number; value: JoinRoomResponse }> {
  return postJson<JoinRoomResponse>("/api/rooms/join", { code, displayName });
}

function validateCreatedRoom(value: CreateRoomResponse): void {
  expect(isRecord(value), "create response is not an object");
  expect(typeof value.roomId === "string" && value.roomId.length > 0, "roomId is empty");
  expect(typeof value.joinCode === "string" && JOIN_CODE.test(value.joinCode), "join code is invalid");
  expect(typeof value.roomToken === "string" && value.roomToken.length > 0, "room token is empty");
  expect(typeof value.wsUrl === "string" && value.wsUrl.length > 0, "wsUrl is empty");
}

function validateJoinedRoom(value: JoinRoomResponse): void {
  expect(isRecord(value), "join response is not an object");
  expect(typeof value.roomId === "string" && value.roomId.length > 0, "roomId is empty");
  expect(typeof value.roomToken === "string" && value.roomToken.length > 0, "room token is empty");
  expect(typeof value.wsUrl === "string" && value.wsUrl.length > 0, "wsUrl is empty");
  expect(typeof value.releaseId === "string" && value.releaseId.length > 0, "releaseId is empty");
}

async function getJson<T>(path: string): Promise<{ status: number; value: T }> {
  const response = await httpRequest(path);
  return { status: response.status, value: parseJson<T>(path, response.body) };
}

async function postJson<T>(
  path: string,
  body: object,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; value: T }> {
  const response = await httpRequest(path, {
    method: "POST",
    headers: { ...apiHeaders(), ...extraHeaders },
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

function apiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Digipology-CSRF": "1",
  };
}

/**
 * Opens a room socket and queues every incoming frame from the moment the
 * connection exists. Frames arriving between reads (for example the
 * system.game_start action delivered right after bootstrap) are never lost.
 */
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

function skip(name: string, detail: string): void {
  console.log(`SKIP ${name} (${detail})`);
  skipped += 1;
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
