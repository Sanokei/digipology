// Zone Runner production smoke: guest quickplay + creator API v1 round trip.
// Usage: bun scripts/smoke-zone-runner.ts https://play.digipology.com
//
// Everything runs as a pure guest (no session cookie):
//   1. two POST /api/quickplay calls for zone-runner land in the same room,
//   2. both clients bootstrap, apply system.game_start through the Lua runtime
//      and agree on the state hash,
//   3. the opening ui:prompt round-trips (prompt.respond) and both clients see
//      the resolved response in scriptState,
//   4. the current player drops a runner into the scoring zone and the script
//      increments that seat's counter on both clients,
//   5. the server-side turn timer fires (system.timer_fire) and converges,
//   6. every timer.registered / timer.canceled report is accepted (204),
//   7. neither client records an unexpected rejection (a stale timer fire that
//      races a reported cancel is tolerated) and both event streams match,
//   8. a late-bootstrap client catches up to the live hash.
import {
  applyOrderedWithScripts,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type KernelEvent,
} from "digipology-kernel";
import {
  createCreatorScriptRuntime,
  scriptsFromReleaseFiles,
  type CreatorScriptRuntime,
} from "digipology-lua";
import { parseServerMessage, type ActionRequest, type ServerMessage } from "digipology-protocol";
import type {
  GamesResponse,
  QuickPlayResponse,
  ReleaseBundleDto,
} from "digipology-protocol/http";

const NETWORK_TIMEOUT_MS = 7_000;
const FRAME_TIMEOUT_MS = 30_000;
const MAX_FRAMES_PER_STEP = 60;
const SCORE_ATTEMPTS = 3;
const SLUG = "zone-runner";
const EXPECTED_RELEASE_ID = "builtin_zone_runner_2";
const JSON_HEADERS = { "Content-Type": "application/json", "X-Digipology-CSRF": "1" };
const origin = parseOrigin(Bun.argv[2] ?? "http://127.0.0.1:8787");
const sockets = new Set<WebSocket>();
const runtimes = new Set<CreatorScriptRuntime>();

let passed = 0;
let failed = 0;

interface FrameWaiter {
  resolve(message: ServerMessage): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface TimerPost {
  operation: "register" | "cancel";
  timerId: string;
  status: number;
}

interface Client {
  name: string;
  playerId: string;
  roomId: string;
  roomToken: string;
  socket: WebSocket;
  runtime: CreatorScriptRuntime;
  state: CanonicalGameState | null;
  events: string[];
  rejections: string[];
  timerPosts: TimerPost[];
  next(): Promise<ServerMessage>;
}

interface Pair {
  a: Client;
  b: Client;
}

interface TurnState {
  order: string[];
  index: number;
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
    for (const runtime of runtimes) runtime.close();
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  }
}

async function runChecks(): Promise<void> {
  await check("catalog lists zone-runner as a builtin", async () => {
    const response = await getJson<GamesResponse>("/api/games");
    expect(response.status === 200, `expected 200, received ${response.status}`);
    const game = response.value.games.find((candidate) => candidate.slug === SLUG);
    expect(game !== undefined, `${SLUG} is missing from /api/games`);
    expect(game.builtin, `${SLUG} is not marked builtin`);
    expect(game.minPlayers === 2, `${SLUG} minPlayers is ${game.minPlayers}, expected 2`);
    return game;
  });

  const seats = await check(
    "two guest quickplay calls share a zone-runner room",
    async () => {
      const first = await postJson<QuickPlayResponse>("/api/quickplay", { slug: SLUG });
      expect(first.status === 200, `first quickplay returned ${first.status}`);
      const second = await postJson<QuickPlayResponse>("/api/quickplay", { slug: SLUG });
      expect(second.status === 200, `second quickplay returned ${second.status}`);
      expect(
        first.value.roomId === second.value.roomId,
        `quickplay split the pair across rooms (${first.value.roomId} versus ${second.value.roomId})`,
      );
      expect(first.value.playerId !== second.value.playerId, "both quickplay joins received the same playerId");
      expect(first.value.releaseId === second.value.releaseId, "quickplay pair disagrees on releaseId");
      expect(
        first.value.releaseId === EXPECTED_RELEASE_ID,
        `quickplay selected ${first.value.releaseId}, expected ${EXPECTED_RELEASE_ID}`,
      );
      return { first: first.value, second: second.value };
    },
    (value) => `room ${value.first.joinCode}`,
  );

  const bundle = await check("release bundle carries a scripted Lua runtime", async () => {
    const quick = requireValue(seats, "two guest quickplay calls share a zone-runner room");
    const response = await getJson<ReleaseBundleDto>(`/api/releases/${encodeURIComponent(quick.first.releaseId)}/bundle`);
    expect(response.status === 200, `bundle fetch returned ${response.status}`);
    expect(response.value.interactionMode === "scripted", `interactionMode is ${response.value.interactionMode}`);
    const scripts = scriptsFromReleaseFiles(response.value.files);
    expect(Object.keys(scripts).length > 0, "bundle has no scripts/*.lua files");
    return response.value;
  });

  const pair = await check("both clients bootstrap and converge after system.game_start", async () => {
    const quick = requireValue(seats, "two guest quickplay calls share a zone-runner room");
    const release = requireValue(bundle, "release bundle carries a scripted Lua runtime");
    const a = await connect("A", quick.first, release);
    const b = await connect("B", quick.second, release);
    const connected: Pair = { a, b };
    await applyOnBoth(connected, isAction("system.game_start"));
    expectConverged(connected);
    return connected;
  }, (value) => `hash ${hashOf(value.a)}`);

  await check("opening prompt round-trips through prompt.respond", async () => {
    const connected = requireValue(pair, "both clients bootstrap and converge after system.game_start");
    const stateA = requireState(connected.a);
    const prompt = Object.values(stateA.prompts).find((candidate) => candidate.status === "open");
    expect(prompt !== undefined, "no open prompt after game_start");
    const owner = clientFor(connected, prompt.playerId);
    expect(owner !== undefined, `prompt is addressed to ${prompt.playerId}, which is neither quickplay guest`);
    const requestId = sendAction(owner, "prompt.respond", { promptId: prompt.id, response: "run" });
    await applyOnBoth(connected, isRequest(requestId));
    const resolved = requireState(connected.a).prompts[prompt.id];
    expect(resolved?.status === "resolved", `prompt status is ${resolved?.status}, expected resolved`);
    expect(resolved.response === "run", `prompt response is ${JSON.stringify(resolved.response)}`);
    expect(scriptField(connected.a, "opening_choice") === "run", "scriptState.opening_choice was not set by on_prompt");
    expectConverged(connected);
    return prompt.id;
  });

  await check("current player scores by dropping a runner into the zone", async () => {
    const connected = requireValue(pair, "both clients bootstrap and converge after system.game_start");
    let lastDetail = "no attempt made";
    for (let attempt = 1; attempt <= SCORE_ATTEMPTS; attempt += 1) {
      const actor = clientFor(connected, currentPlayerId(connected.a));
      expect(actor !== undefined, "current player is neither quickplay guest");
      const seat = seatOf(actor);
      const scoreBefore = counterValue(actor, seat.scoreId);
      const runner = handItems(actor, seat.handId)[0];
      expect(runner !== undefined, `${actor.name} has no runner left in hand`);
      const slot = freeSlot(actor);
      expect(slot !== undefined, "no free snap-point slot left in the scoring zone");
      const turnBefore = turnState(actor).index;
      const grab = sendAction(actor, "entity.grab", { entityId: runner });
      await applyOnBoth(connected, isRequest(grab));
      const drop = sendAction(actor, "entity.drop", { entityId: runner, transform: transformAt(actor, slot) });
      await applyOnBoth(connected, isRequest(drop));
      expectConverged(connected);
      const scoreAfter = counterValue(actor, seat.scoreId);
      if (scoreAfter === scoreBefore + 1) {
        return `${actor.name} scored ${scoreBefore} -> ${scoreAfter} on attempt ${attempt}`;
      }
      // A turn timer can still hand the turn over between grab and drop; retry with the new current player.
      lastDetail = `attempt ${attempt}: ${actor.name} dropped ${runner} but score stayed ${scoreAfter} (turn index ${turnBefore} -> ${turnState(actor).index})`;
    }
    throw new Error(lastDetail);
  }, (detail) => detail);

  await check("server-side turn timer fires and converges", async () => {
    const connected = requireValue(pair, "both clients bootstrap and converge after system.game_start");
    const started = Date.now();
    await applyOnBoth(connected, isAction("system.timer_fire"));
    expectConverged(connected);
    const timeouts = scriptField(connected.a, "timeouts");
    expect(typeof timeouts === "number" && timeouts >= 1, `scriptState.timeouts is ${JSON.stringify(timeouts)}`);
    return `${Date.now() - started}ms, timeouts ${timeouts}`;
  }, (detail) => detail);

  await check("timer metadata reports are all accepted", async () => {
    const connected = requireValue(pair, "both clients bootstrap and converge after system.game_start");
    const posts = [...connected.a.timerPosts, ...connected.b.timerPosts];
    expect(posts.some((post) => post.operation === "register"), "no timer.registered event was reported");
    const rejected = posts.filter((post) => post.status !== 204);
    expect(rejected.length === 0, `non-204 timer posts: ${JSON.stringify(rejected)}`);
    return `${posts.length} posts`;
  }, (detail) => detail);

  await check("no unexpected script rejections and identical event streams", async () => {
    const connected = requireValue(pair, "both clients bootstrap and converge after system.game_start");
    const unexpectedA = unexpectedRejections(connected.a);
    const unexpectedB = unexpectedRejections(connected.b);
    expect(unexpectedA.length === 0, `A rejections: ${JSON.stringify(unexpectedA)}`);
    expect(unexpectedB.length === 0, `B rejections: ${JSON.stringify(unexpectedB)}`);
    expect(
      connected.a.rejections.join(",") === connected.b.rejections.join(","),
      "clients disagree on which frames were rejected",
    );
    expect(
      connected.a.events.join(",") === connected.b.events.join(","),
      "clients disagree on the emitted kernel events",
    );
    const stale = connected.a.rejections.length;
    return `${connected.a.events.length} events${stale > 0 ? `, ${stale} stale timer fire(s) rejected on both` : ""}`;
  }, (detail) => detail);

  await check("late-bootstrap client converges to the live hash", async () => {
    const connected = requireValue(pair, "both clients bootstrap and converge after system.game_start");
    const quick = requireValue(seats, "two guest quickplay calls share a zone-runner room");
    const release = requireValue(bundle, "release bundle carries a scripted Lua runtime");
    const late = await connect("C", quick.first, release);
    await applyUntil(late, (message) => message.type === "bootstrap");
    // The turn timer keeps sequencing frames; park both clients on the same sequence before comparing.
    const goal = Math.max(requireState(connected.a).sequence, requireState(late).sequence);
    const reached = (message: ServerMessage): boolean => message.type === "ordered_action" && message.sequence >= goal;
    if (requireState(connected.a).sequence < goal) await applyUntil(connected.a, reached);
    if (requireState(late).sequence < goal) await applyUntil(late, reached);
    const liveHash = hashOf(connected.a);
    expect(hashOf(late) === liveHash, `late client hash ${hashOf(late)} differs from live ${liveHash} at sequence ${goal}`);
    const unexpected = unexpectedRejections(late);
    expect(unexpected.length === 0, `late client rejections: ${JSON.stringify(unexpected)}`);
    return `sequence ${goal}`;
  }, (detail) => detail);
}

async function connect(name: string, quick: QuickPlayResponse, release: ReleaseBundleDto): Promise<Client> {
  const initial = loadSnapshot(release.initialSnapshot as GameSnapshot);
  const entityRefs = Object.fromEntries(Object.keys(initial.entities).sort().map((id) => [id, id]));
  const runtime = await createCreatorScriptRuntime({
    scripts: scriptsFromReleaseFiles(release.files),
    refs: { ...entityRefs, ...(release.refs ?? {}) },
    definitions: release.definitions ?? {},
    instructionBudget: 50_000,
    memoryBudgetBytes: 512 * 1024,
  });
  runtimes.add(runtime);

  const socket = new WebSocket(webSocketTarget(quick.wsUrl));
  sockets.add(socket);
  const frames: ServerMessage[] = [];
  const waiters: FrameWaiter[] = [];
  let failure: Error | null = null;

  const push = (message: ServerMessage): void => {
    const waiter = waiters.shift();
    if (waiter === undefined) {
      frames.push(message);
      return;
    }
    clearTimeout(waiter.timeout);
    waiter.resolve(message);
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
      fail(new Error(`${name}: expected a text WebSocket frame`));
      return;
    }
    const parsed = parseServerMessage(event.data);
    if (!parsed.ok) {
      fail(new Error(`${name}: bad server message: ${parsed.error.detail}`));
      return;
    }
    push(parsed.message);
  });
  socket.addEventListener("close", (event) => {
    fail(new Error(`${name}: socket closed (${event.code}) ${event.reason}`));
  });
  socket.addEventListener("error", () => {
    fail(new Error(`${name}: socket error`));
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name}: socket open timed out`)), NETWORK_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`${name}: socket failed to open`));
    }, { once: true });
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: quick.roomToken, lastSequence: null }));

  return {
    name,
    playerId: quick.playerId,
    roomId: quick.roomId,
    roomToken: quick.roomToken,
    socket,
    runtime,
    state: null,
    events: [],
    rejections: [],
    timerPosts: [],
    next() {
      const queued = frames.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      if (failure !== null) return Promise.reject(failure);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timeout === timeout);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`${name}: timed out waiting for a frame`));
        }, FRAME_TIMEOUT_MS);
        waiters.push({ resolve, reject, timeout });
      });
    },
  };
}

/** Applies frames through the scripted kernel until `done` accepts one; reports timer metadata like the web client. */
async function applyUntil(client: Client, done: (message: ServerMessage) => boolean): Promise<ServerMessage> {
  for (let index = 0; index < MAX_FRAMES_PER_STEP; index += 1) {
    const message = await client.next();
    if (message.type === "bootstrap") {
      client.state = loadSnapshot(message.snapshot as GameSnapshot);
      if (done(message)) return message;
      continue;
    }
    if (message.type !== "ordered_action") {
      throw new Error(`${client.name}: unexpected frame ${message.type}: ${JSON.stringify(message).slice(0, 200)}`);
    }
    const state = requireState(client);
    if (message.sequence !== state.sequence + 1) {
      throw new Error(`${client.name}: sequence gap, expected ${state.sequence + 1} got ${message.sequence}`);
    }
    const result = await applyOrderedWithScripts(
      state,
      { sequence: message.sequence, actionId: message.actionId, actor: message.actor, action: message.action },
      { runtime: client.runtime },
    );
    client.state = result.state;
    client.events.push(...result.events.map((event) => `${message.sequence}:${event.type}`));
    if (result.rejection !== undefined) {
      client.rejections.push(`${message.sequence}:${message.action.type}:${result.rejection.reason}`);
    }
    await reportTimers(client, result.events);
    if (done(message)) return message;
  }
  throw new Error(`${client.name}: predicate not met within ${MAX_FRAMES_PER_STEP} frames`);
}

async function applyOnBoth(pair: Pair, done: (message: ServerMessage) => boolean): Promise<void> {
  await applyUntil(pair.a, done);
  await applyUntil(pair.b, done);
}

async function reportTimers(client: Client, events: readonly KernelEvent[]): Promise<void> {
  for (const event of events) {
    if (event.type !== "timer.registered" && event.type !== "timer.canceled") continue;
    const operation = event.type === "timer.registered" ? "register" : "cancel";
    const timerId = String(event.data.timerId);
    const body = operation === "register"
      ? { roomToken: client.roomToken, operation, timerId, delay: event.data.delay }
      : { roomToken: client.roomToken, operation, timerId };
    const response = await fetch(`${origin}/api/rooms/${encodeURIComponent(client.roomId)}/timers`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    client.timerPosts.push({ operation, timerId, status: response.status });
  }
}

function sendAction(client: Client, type: string, payload: unknown): string {
  const request: ActionRequest = {
    type: "action_request",
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    predictedAtSequence: requireState(client).sequence,
    action: { type, payload },
  };
  client.socket.send(JSON.stringify(request));
  return request.requestId;
}

function isAction(type: string): (message: ServerMessage) => boolean {
  return (message) => message.type === "ordered_action" && message.action.type === type;
}

function isRequest(requestId: string): (message: ServerMessage) => boolean {
  return (message) => message.type === "ordered_action" && message.requestId === requestId;
}

function expectConverged(pair: Pair): void {
  const a = hashOf(pair.a);
  const b = hashOf(pair.b);
  expect(a === b, `state hash diverged: A ${a} versus B ${b}`);
}

/**
 * The room sequences a timer fire from its own alarm and only learns about a
 * script-side timer:cancel once a client reports it, so a fire can land one
 * frame after the cancel. Every client rejects that frame identically, which
 * keeps hashes converged; anything else is a real problem.
 */
function unexpectedRejections(client: Client): string[] {
  return client.rejections.filter((entry) => !entry.includes(":system.timer_fire:Timer has already fired or was canceled"));
}

function hashOf(client: Client): string {
  return snapshot(requireState(client)).stateHash;
}

function requireState(client: Client): CanonicalGameState {
  if (client.state === null) throw new Error(`${client.name} has not bootstrapped`);
  return client.state;
}

function clientFor(pair: Pair, playerId: string): Client | undefined {
  if (pair.a.playerId === playerId) return pair.a;
  if (pair.b.playerId === playerId) return pair.b;
  return undefined;
}

function scriptField(client: Client, key: string): unknown {
  const scriptState = requireState(client).scriptState;
  return isRecord(scriptState) ? scriptState[key] : undefined;
}

function turnState(client: Client): TurnState {
  const stdlib = scriptField(client, "__stdlib");
  const turns = isRecord(stdlib) ? stdlib.turns : undefined;
  expect(isRecord(turns) && Array.isArray(turns.order) && typeof turns.index === "number", "scriptState.__stdlib.turns is missing");
  return { order: turns.order.map(String), index: turns.index };
}

/** stdlib turns.index points one past the current player. */
function currentPlayerId(client: Client): string {
  const turns = turnState(client);
  const current = turns.order[(turns.index - 1 + turns.order.length) % turns.order.length];
  expect(current !== undefined, "turn order is empty");
  return current;
}

function seatOf(client: Client): { handId: string; scoreId: string } {
  const seat = Object.values(requireState(client).seats).find((candidate) => candidate.playerId === client.playerId);
  expect(seat !== undefined, `${client.name} has no seat`);
  expect(typeof seat.handId === "string" && typeof seat.scoreId === "string", `${client.name} seat lacks handId/scoreId`);
  return { handId: seat.handId, scoreId: seat.scoreId };
}

function componentOf(client: Client, entityId: string, component: string): Record<string, unknown> | undefined {
  const value = requireState(client).entities[entityId]?.components[component];
  return isRecord(value) ? value : undefined;
}

function counterValue(client: Client, scoreId: string): number {
  const counter = componentOf(client, scoreId, "counter");
  expect(counter !== undefined && typeof counter.value === "number", `${scoreId} has no numeric counter`);
  return counter.value;
}

function handItems(client: Client, handId: string): string[] {
  const container = componentOf(client, handId, "container");
  expect(container !== undefined && Array.isArray(container.items), `${handId} has no container items`);
  return container.items.map(String);
}

function freeSlot(client: Client): string | undefined {
  const state = requireState(client);
  return Object.keys(state.entities).sort().find((id) => {
    const snap = componentOf(client, id, "snap-point");
    return snap !== undefined && Array.isArray(snap.attached) && snap.attached.length === 0;
  });
}

function transformAt(client: Client, entityId: string): unknown {
  const transform = componentOf(client, entityId, "transform");
  expect(transform !== undefined && isRecord(transform.position), `${entityId} has no transform position`);
  return { position: transform.position, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } };
}

function webSocketTarget(value: string): string {
  const target = new URL(value);
  const local = new URL(origin);
  if (local.hostname !== "127.0.0.1" && local.hostname !== "localhost") {
    return target.toString();
  }
  target.protocol = local.protocol === "https:" ? "wss:" : "ws:";
  target.host = local.host;
  return target.toString();
}

async function getJson<T>(path: string): Promise<{ status: number; value: T }> {
  return httpJson<T>(path, { method: "GET" });
}

async function postJson<T>(path: string, body: object): Promise<{ status: number; value: T }> {
  return httpJson<T>(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

async function httpJson<T>(path: string, init: Omit<RequestInit, "signal">): Promise<{ status: number; value: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}${path}`, { ...init, signal: controller.signal });
    const body = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      throw new Error(`${path} returned non-JSON (${response.status}): ${body.slice(0, 120)}`);
    }
    return { status: response.status, value: value as T };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${path} timed out after ${NETWORK_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
