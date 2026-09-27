// Saved-table network smoke: authenticated host save + new-room resume.
// Usage: SMOKE_SESSION=<local dgp_session token> bun scripts/smoke-saves.ts http://127.0.0.1:8787
// Default exercises host-first arrival. SMOKE_PREJOIN=1 retains the baseline
// simultaneous-roster scenario. The default also checks late-guest score and turn recovery.
//
// Runs full save/resume convergence for unscripted First Deal and scripted
// Zone Runner v2, including resumed Lua stdlib roster reconciliation.
import {
  applyOrdered,
  applyOrderedWithScripts,
  loadSnapshot,
  snapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type JsonValue,
} from "digipology-kernel";
import {
  createCreatorScriptRuntime,
  scriptsFromReleaseFiles,
  type CreatorScriptRuntime,
} from "digipology-lua";
import { parseServerMessage, type ActionRequest, type ServerMessage } from "digipology-protocol";
import type {
  ApiErrorResponse,
  CreateRoomResponse,
  JoinRoomResponse,
  ReleaseBundleDto,
  ResumeSaveResponse,
  SaveTableResponse,
  SavesResponse,
} from "digipology-protocol/http";

const NETWORK_TIMEOUT_MS = 7_000;
const FRAME_TIMEOUT_MS = 30_000;
const MAX_FRAMES_PER_STEP = 80;
const JSON_HEADERS = { "Content-Type": "application/json", "X-Digipology-CSRF": "1" };
const origin = parseOrigin(Bun.argv[2] ?? "http://127.0.0.1:8787");
const sessionToken = Bun.env.SMOKE_SESSION;
const sockets = new Set<WebSocket>();
const runtimes = new Set<CreatorScriptRuntime>();

let passed = 0;
let failed = 0;

interface FrameWaiter {
  resolve(message: ServerMessage): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RoomCredentials {
  roomId: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
}

interface Client {
  name: string;
  playerId: string;
  roomId: string;
  roomToken: string;
  socket: WebSocket;
  runtime: CreatorScriptRuntime | null;
  state: CanonicalGameState | null;
  bootstrapHash: string | null;
  hashes: Map<number, string>;
  actions: string[];
  rejections: string[];
  next(): Promise<ServerMessage>;
}

interface Pair { a: Client; b: Client; }

async function main(): Promise<void> {
  if (sessionToken === undefined || sessionToken.length === 0) {
    throw new Error("SMOKE_SESSION must contain an authenticated dgp_session token");
  }
  try {
    await runScenario("first-deal", false);
    await runScenario("zone-runner", true);
  } finally {
    for (const socket of sockets) {
      try { socket.close(1000, "Smoke complete"); } catch {}
    }
    for (const runtime of runtimes) runtime.close();
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  }
}

async function runScenario(slug: "first-deal" | "zone-runner", scripted: boolean): Promise<void> {
  const label = scripted ? "scripted Zone Runner v2" : "unscripted First Deal";
  const checkName = `${label}: save/resume convergence`;
  await check(checkName, async () => {
    const created = await postJson<CreateRoomResponse>(
      "/api/rooms",
      { releaseSlugOrId: slug, visibility: "private", displayName: `${label} Host` },
      authHeaders(),
    );
    expect(created.status === 201, `create returned ${created.status}`);
    const joined = await postJson<JoinRoomResponse>(
      "/api/rooms/join",
      { code: created.value.joinCode, displayName: `${label} Guest` },
    );
    expect(joined.status === 200, `join returned ${joined.status}`);
    expect(joined.value.roomId === created.value.roomId, "room A join returned another room");

    const bundleResponse = await getJson<ReleaseBundleDto>(
      `/api/releases/${encodeURIComponent(joined.value.releaseId)}/bundle`,
    );
    expect(bundleResponse.status === 200, `bundle returned ${bundleResponse.status}`);
    expect(
      bundleResponse.value.interactionMode === (scripted ? "scripted" : "sandbox"),
      `unexpected interaction mode ${bundleResponse.value.interactionMode}`,
    );
    if (scripted) {
      expect(joined.value.releaseId === "builtin_zone_runner_2", `expected Zone Runner v2, got ${joined.value.releaseId}`);
    }

    const roomA: Pair = {
      a: await connect("A host", created.value, bundleResponse.value),
      b: await connect("A guest", joined.value, bundleResponse.value),
    };
    await applyOnBoth(roomA, (message) => message.type === "ordered_action" && message.action.type === "system.game_start");
    expectConvergedAtEverySequence(roomA);

    if (scripted) {
      const prompt = Object.values(requireState(roomA.a).prompts)
        .find((candidate) => candidate.status === "open" && candidate.playerId === roomA.a.playerId);
      expect(prompt !== undefined, "host has no opening Zone Runner prompt");
      await sendAndApply(roomA, roomA.a, "prompt.respond", { promptId: prompt.id, response: "run" });
      // Both seats earn a point before saving: resetting a returning guest to
      // zero must fail even if both clients converge on that incorrect state.
      for (const [client, piece] of [[roomA.a, "runner_seat_1_a"], [roomA.b, "runner_seat_2_a"]] as const) {
        await sendAndApply(roomA, client, "entity.grab", { entityId: piece });
        await sendAndApply(roomA, client, "entity.drop", { entityId: piece, transform: {
          position: { x: -3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        } });
      }
    }

    const entityId = findGrabbable(requireState(roomA.a));
    await sendAndApply(roomA, roomA.a, "entity.grab", { entityId });
    expect(heldBy(requireState(roomA.a), entityId) === roomA.a.playerId, "host did not hold the entity before save");
    const savedState = snapshot(requireState(roomA.a));
    const serializedSave = JSON.stringify(savedState);
    for (const transient of ["camera", "cursor", "hover", "webrtc"]) {
      expect(!serializedSave.toLowerCase().includes(`\"${transient}\"`), `save contains ${transient} state`);
    }

    const signedOut = await postJson<ApiErrorResponse>(
      `/api/rooms/${created.value.roomId}/save`,
      { roomToken: created.value.roomToken, snapshot: savedState },
    );
    expect(signedOut.status === 401, `signed-out save returned ${signedOut.status}`);
    expect(signedOut.value.error.code === "authentication_required", "signed-out save returned the wrong error");
    const nonHost = await postJson<ApiErrorResponse>(
      `/api/rooms/${created.value.roomId}/save`,
      { roomToken: joined.value.roomToken, snapshot: savedState },
      authHeaders(),
    );
    expect(nonHost.status === 403, `non-host save returned ${nonHost.status}`);
    expect(nonHost.value.error.code === "save_host_only", "non-host save returned the wrong error");

    const saved = await postJson<SaveTableResponse>(
      `/api/rooms/${created.value.roomId}/save`,
      { roomToken: created.value.roomToken, snapshot: savedState, label: `Smoke ${label}` },
      authHeaders(),
    );
    expect(saved.status === 201, `host save returned ${saved.status}`);
    expect(saved.value.sequence === savedState.sequence, "save response sequence differs from confirmed state");
    expect(saved.value.stateHash === savedState.stateHash, "save response hash differs from confirmed state");

    const listed = await httpJson<SavesResponse>("/api/saves", {
      method: "GET",
      headers: authHeaders(),
    });
    expect(listed.status === 200, `save listing returned ${listed.status}`);
    const listedSave = listed.value.saves.find((save) => save.saveId === saved.value.saveId);
    expect(listedSave !== undefined, "new save is missing from the saved-tables list");
    expect(listedSave.resumable !== false, `${label} save is marked non-resumable`);
    expect(listedSave.resumeBlockedReason === undefined, `${label} save still carries a resume block reason`);

    const resumed = await postJson<ResumeSaveResponse>(
      `/api/saves/${encodeURIComponent(saved.value.saveId)}/resume`,
      { visibility: "private", displayName: `${label} Resumed Host` },
      authHeaders(),
    );
    expect(resumed.status === 201, `resume returned ${resumed.status}`);
    expect(resumed.value.roomId !== created.value.roomId, "resume reused room A");
    expect(resumed.value.joinCode !== created.value.joinCode, "resume reused room A's invite code");
    const hostFirst = Bun.env.SMOKE_PREJOIN !== "1";
    const resumedHost = hostFirst ? await connect("B host", resumed.value, bundleResponse.value) : null;
    if (resumedHost !== null) await applyUntil(resumedHost,
      (message) => message.type === "ordered_action" && message.action.type === "system.game_resumed");
    const resumedGuest = await postJson<JoinRoomResponse>(
      "/api/rooms/join",
      { code: resumed.value.joinCode, displayName: `${label} Resumed Guest` },
    );
    expect(resumedGuest.status === 200, `room B join returned ${resumedGuest.status}`);

    const roomB: Pair = {
      a: resumedHost ?? await connect("B host", resumed.value, bundleResponse.value),
      b: await connect("B guest", resumedGuest.value, bundleResponse.value),
    };
    const oldPlayers = new Set([roomA.a.playerId, roomA.b.playerId]);
    await applyUntil(roomB.a, (_message, client) => resumedRosterReady(client, roomB, oldPlayers));
    await applyUntil(roomB.b, (_message, client) => resumedRosterReady(client, roomB, oldPlayers));

    const expectedBase = snapshot({ ...loadSnapshot(savedState), sequence: 0 }).stateHash;
    expect(roomB.a.bootstrapHash === expectedBase, `room B host base hash ${roomB.a.bootstrapHash} differs from ${expectedBase}`);
    expect(roomB.b.bootstrapHash === expectedBase, `room B guest base hash ${roomB.b.bootstrapHash} differs from ${expectedBase}`);
    expect(!roomB.a.actions.includes("system.game_start"), "resume emitted system.game_start");
    expect(!roomB.b.actions.includes("system.game_start"), "resume emitted system.game_start to guest");
    expect(roomB.a.actions.includes("system.game_resumed"), "resume did not emit system.game_resumed");
    expect(roomB.b.actions.includes("system.game_resumed"), "guest did not receive system.game_resumed");
    expect(heldBy(requireState(roomB.a), entityId) === null, "mid-grab entity remained held after resume");
    expectConvergedAtEverySequence(roomB);

    if (scripted) {
      const scriptState = requireState(roomB.a).scriptState as {
        __stdlib?: { turns?: { order?: unknown[]; index?: number }; scores?: Record<string, unknown> };
      };
      const turns = scriptState.__stdlib?.turns;
      const scores = scriptState.__stdlib?.scores;
      expect(Array.isArray(turns?.order), "resumed turn order is missing");
      expect(turns!.order!.every((playerId) => playerId === roomB.a.playerId || playerId === roomB.b.playerId),
        `resumed turn order contains a ghost: ${JSON.stringify(turns?.order)}`);
      expect(Object.keys(scores ?? {}).every((key) => !oldPlayers.has(key)),
        `resumed scores contain a ghost: ${JSON.stringify(scores)}`);
      const oldStdlib = savedState.state.scriptState as {
        __stdlib: { turns: { order: string[]; index: number }; scores: Record<string, number> };
      };
      const savedSeats = Object.keys(savedState.state.seats).sort();
      const mapping = new Map(savedSeats.slice(0, 2).map((seatId, index) =>
        [savedState.state.seats[seatId]!.playerId, index === 0 ? roomB.a.playerId : roomB.b.playerId]));
      for (const [oldId, newId] of mapping) {
        if (typeof oldId === "string" && oldStdlib.__stdlib.scores[oldId] !== undefined) {
          expect(scores?.[newId] === oldStdlib.__stdlib.scores[oldId],
            `F2: returning seat lost score ${oldStdlib.__stdlib.scores[oldId]}`);
        }
      }
      const expectedCurrent = mapping.get(oldStdlib.__stdlib.turns.order[oldStdlib.__stdlib.turns.index - 1]!);
      const current = turns!.order![Math.max(0, (turns?.index ?? 1) - 1)];
      expect(current === expectedCurrent, `F2: saved current turn was not restored`);
      expect(current === roomB.a.playerId || current === roomB.b.playerId,
        `current resumed player ${String(current)} is not live`);
    }

    await sendAndApply(roomB, roomB.a, "entity.grab", { entityId });
    await sendAndApply(roomB, roomB.a, "entity.drop", {
      entityId,
      transform: entityTransform(requireState(roomB.a), entityId),
    });
    expectConvergedAtEverySequence(roomB);
    expect(roomB.a.rejections.length === 0, `room B host rejections: ${JSON.stringify(roomB.a.rejections)}`);
    expect(roomB.b.rejections.length === 0, `room B guest rejections: ${JSON.stringify(roomB.b.rejections)}`);

    const removed = await httpJson<unknown>(`/api/saves/${encodeURIComponent(saved.value.saveId)}`, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, ...authHeaders() },
    });
    expect(removed.status === 204, `save cleanup returned ${removed.status}`);
    return `${saved.value.saveId} -> ${resumed.value.roomId}`;
  }, (detail) => detail);
}

async function connect(name: string, credentials: RoomCredentials, release: ReleaseBundleDto): Promise<Client> {
  const initial = loadSnapshot(release.initialSnapshot as GameSnapshot);
  let runtime: CreatorScriptRuntime | null = null;
  if (release.interactionMode === "scripted") {
    const entityRefs = Object.fromEntries(Object.keys(initial.entities).sort().map((id) => [id, id]));
    runtime = await createCreatorScriptRuntime({
      scripts: scriptsFromReleaseFiles(release.files),
      refs: { ...entityRefs, ...(release.refs ?? {}) },
      definitions: (release.definitions ?? {}) as unknown as Readonly<Record<string, JsonValue>>,
      instructionBudget: 50_000,
      memoryBudgetBytes: 512 * 1024,
    });
    runtimes.add(runtime);
  }
  const socket = new WebSocket(webSocketTarget(credentials.wsUrl));
  sockets.add(socket);
  const frames: ServerMessage[] = [];
  const waiters: FrameWaiter[] = [];
  let failure: Error | null = null;
  const fail = (error: Error): void => {
    if (failure === null) failure = error;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  };
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return fail(new Error(`${name}: expected text frame`));
    const parsed = parseServerMessage(event.data);
    if (!parsed.ok) return fail(new Error(`${name}: ${parsed.error.detail}`));
    const waiter = waiters.shift();
    if (waiter === undefined) frames.push(parsed.message);
    else {
      clearTimeout(waiter.timeout);
      waiter.resolve(parsed.message);
    }
  });
  socket.addEventListener("error", () => fail(new Error(`${name}: socket error`)));
  socket.addEventListener("close", (event) => fail(new Error(`${name}: socket closed (${event.code}) ${event.reason}`)));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name}: socket open timed out`)), NETWORK_TIMEOUT_MS);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(`${name}: socket failed to open`)); }, { once: true });
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, sessionToken: credentials.roomToken, lastSequence: null }));
  return {
    name,
    playerId: credentials.playerId,
    roomId: credentials.roomId,
    roomToken: credentials.roomToken,
    socket,
    runtime,
    state: null,
    bootstrapHash: null,
    hashes: new Map(),
    actions: [],
    rejections: [],
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

async function applyUntil(
  client: Client,
  done: (message: ServerMessage, client: Client) => boolean,
  maxFrames = MAX_FRAMES_PER_STEP,
): Promise<void> {
  for (let index = 0; index < maxFrames; index += 1) {
    const message = await client.next();
    if (message.type === "bootstrap") {
      client.state = loadSnapshot(message.snapshot as GameSnapshot);
      const hash = snapshot(client.state).stateHash;
      client.bootstrapHash ??= hash;
      client.hashes.set(client.state.sequence, hash);
      if (done(message, client)) return;
      continue;
    }
    if (message.type !== "ordered_action") {
      throw new Error(`${client.name}: unexpected ${message.type}`);
    }
    const state = requireState(client);
    expect(message.sequence === state.sequence + 1, `${client.name}: expected sequence ${state.sequence + 1}, got ${message.sequence}`);
    const ordered = {
      sequence: message.sequence,
      actionId: message.actionId,
      actor: message.actor,
      action: message.action,
    };
    const result = client.runtime === null
      ? applyOrdered(state, ordered)
      : await applyOrderedWithScripts(state, ordered, { runtime: client.runtime });
    client.state = result.state;
    client.actions.push(message.action.type);
    client.hashes.set(result.state.sequence, snapshot(result.state).stateHash);
    if (result.rejection !== undefined) {
      client.rejections.push(`${message.sequence}:${message.action.type}:${result.rejection.reason}`);
    }
    if (done(message, client)) return;
  }
  throw new Error(`${client.name}: predicate not met within ${maxFrames} frames`);
}

async function applyOnBoth(pair: Pair, done: (message: ServerMessage, client: Client) => boolean): Promise<void> {
  await applyUntil(pair.a, done);
  await applyUntil(pair.b, done);
}

async function sendAndApply(pair: Pair, actor: Client, type: string, payload: unknown): Promise<void> {
  const request: ActionRequest = {
    type: "action_request",
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    predictedAtSequence: requireState(actor).sequence,
    action: { type, payload },
  };
  actor.socket.send(JSON.stringify(request));
  const done = (message: ServerMessage) => message.type === "ordered_action" && message.requestId === request.requestId;
  await applyOnBoth(pair, done);
  expectConvergedAtEverySequence(pair);
}

function resumedRosterReady(client: Client, pair: Pair, oldPlayers: ReadonlySet<string>): boolean {
  const state = requireState(client);
  return state.players[pair.a.playerId] !== undefined &&
    state.players[pair.b.playerId] !== undefined &&
    [...oldPlayers].every((playerId) => state.players[playerId] === undefined) &&
    Object.values(state.seats).filter((seat) => seat.playerId === pair.a.playerId || seat.playerId === pair.b.playerId).length === 2;
}

function expectConvergedAtEverySequence(pair: Pair): void {
  const sequencesA = [...pair.a.hashes.keys()].sort((left, right) => left - right);
  const sequencesB = [...pair.b.hashes.keys()].sort((left, right) => left - right);
  expect(JSON.stringify(sequencesA) === JSON.stringify(sequencesB), `hash histories cover different sequences: ${sequencesA} versus ${sequencesB}`);
  for (const sequence of sequencesA) {
    expect(pair.a.hashes.get(sequence) === pair.b.hashes.get(sequence), `state hash diverged at sequence ${sequence}`);
  }
}

function findGrabbable(state: CanonicalGameState): string {
  const entityId = Object.keys(state.entities).sort().find((id) => state.entities[id]?.components.grabbable !== undefined);
  expect(entityId !== undefined, "room has no grabbable entity");
  return entityId;
}

function heldBy(state: CanonicalGameState, entityId: string): string | null | undefined {
  return state.entities[entityId]?.components.grabbable?.heldBy;
}

function entityTransform(state: CanonicalGameState, entityId: string): unknown {
  const transform = state.entities[entityId]?.components.transform;
  expect(transform !== undefined, `${entityId} has no transform`);
  return transform;
}

function requireState(client: Client): CanonicalGameState {
  if (client.state === null) throw new Error(`${client.name} has not bootstrapped`);
  return client.state;
}

function webSocketTarget(value: string): string {
  const target = new URL(value);
  const local = new URL(origin);
  if (local.hostname === "127.0.0.1" || local.hostname === "localhost") {
    target.protocol = local.protocol === "https:" ? "wss:" : "ws:";
    target.host = local.host;
  }
  return target.toString();
}

async function getJson<T>(path: string): Promise<{ status: number; value: T }> {
  return httpJson<T>(path, { method: "GET" });
}

async function postJson<T>(
  path: string,
  body: object,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; value: T }> {
  return httpJson<T>(path, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

async function httpJson<T>(
  path: string,
  init: Omit<RequestInit, "signal">,
): Promise<{ status: number; value: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}${path}`, { ...init, signal: controller.signal });
    if (response.status === 204) return { status: response.status, value: undefined as T };
    const body = await response.text();
    try {
      return { status: response.status, value: JSON.parse(body) as T };
    } catch {
      throw new Error(`${path} returned non-JSON (${response.status}): ${body.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(): Record<string, string> {
  return { Cookie: `dgp_session=${sessionToken}` };
}

async function check<T>(name: string, action: () => Promise<T>, detail?: (value: T) => string): Promise<void> {
  try {
    const value = await action();
    console.log(`PASS ${name}${detail === undefined ? "" : `: ${detail(value)}`}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}: ${errorDetail(error)}`);
    failed += 1;
  }
}

function expect(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("origin must use http or https");
  if (parsed.username !== "" || parsed.password !== "") throw new Error("origin must not contain credentials");
  return parsed.origin;
}

main().catch((error: unknown) => {
  console.error(`FAIL smoke run: ${errorDetail(error)}`);
  process.exitCode = 1;
});
