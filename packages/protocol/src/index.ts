export const PROTOCOL_VERSION = 1 as const;

export type Actor =
  | { type: "player"; playerId: string }
  | { type: "system" };

export interface PlayerInfo {
  playerId: string;
  displayName: string;
  seatId: string | null;
  connected: boolean;
}

export type ProtocolErrorCode =
  | "unsupported_protocol_version"
  | "invalid_session"
  | "malformed_message"
  | "message_too_large"
  | "rate_limited"
  | "bootstrap_unavailable"
  | "unknown_message_type";

export type HelloMessage = {
  type: "hello";
  protocolVersion: 1;
  sessionToken: string;
  lastSequence: number | null;
};

export type ActionRequest = {
  type: "action_request";
  protocolVersion: 1;
  requestId: string;
  predictedAtSequence: number;
  action: { type: string; payload: unknown };
};

export type PingMessage = {
  type: "ping";
  protocolVersion: 1;
  t?: number;
};

export type ClientMessage = HelloMessage | ActionRequest | PingMessage;

export type BootstrapMessage = {
  type: "bootstrap";
  protocolVersion: 1;
  sequence: number;
  snapshot?: unknown;
  players: PlayerInfo[];
};

export type ResumeMessage = {
  type: "resume";
  protocolVersion: 1;
  fromSequence: number;
  actions: OrderedAction[];
};

export type ResyncRequiredMessage = {
  type: "resync_required";
  protocolVersion: 1;
};

export type ProtocolErrorMessage = {
  type: "protocol_error";
  protocolVersion: 1;
  code: ProtocolErrorCode;
  message: string;
};

export type RoomEndedMessage = {
  type: "room_ended";
  protocolVersion: 1;
  reason: "host_ended" | "expired" | "moderation";
};

export type OrderedAction = {
  type: "ordered_action";
  protocolVersion: 1;
  sequence: number;
  actionId: string;
  requestId?: string;
  actor: Actor;
  action: { type: string; payload: unknown };
};

export type PongMessage = {
  type: "pong";
  protocolVersion: 1;
  t?: number;
};

export type ServerMessage =
  | BootstrapMessage
  | ResumeMessage
  | ResyncRequiredMessage
  | ProtocolErrorMessage
  | RoomEndedMessage
  | OrderedAction
  | PongMessage;

export type ParseErrorCode =
  | "malformed_message"
  | "unsupported_protocol_version"
  | "unknown_message_type"
  | "message_too_large";

export type ParseResult<T> =
  | { ok: true; message: T }
  | {
      ok: false;
      error: { code: ParseErrorCode; detail: string; path?: string };
    };

export interface ParseOptions {
  maxBytes?: number;
}

export const DEFAULT_MESSAGE_SIZE_LIMITS = Object.freeze({
  hello: 4 * 1024,
  action_request: 32 * 1024,
  ping: 256,
  bootstrap: 4 * 1024 * 1024,
  resume: 4 * 1024 * 1024,
  resync_required: 4 * 1024,
  protocol_error: 4 * 1024,
  room_ended: 4 * 1024,
  ordered_action: 64 * 1024,
  pong: 256,
} as const);

type ParseFailure = Extract<ParseResult<never>, { ok: false }>;
type JsonObject = Record<string, unknown>;

const CLIENT_TYPES = new Set(["hello", "action_request", "ping"]);
const SERVER_TYPES = new Set([
  "bootstrap",
  "resume",
  "resync_required",
  "protocol_error",
  "room_ended",
  "ordered_action",
  "pong",
]);
const PROTOCOL_ERROR_CODES = new Set<string>([
  "unsupported_protocol_version",
  "invalid_session",
  "malformed_message",
  "message_too_large",
  "rate_limited",
  "bootstrap_unavailable",
  "unknown_message_type",
]);
const ROOM_END_REASONS = new Set<string>([
  "host_ended",
  "expired",
  "moderation",
]);

export function parseClientMessage(
  json: string,
  opts?: ParseOptions,
): ParseResult<ClientMessage> {
  return parseMessage(json, opts, "client") as ParseResult<ClientMessage>;
}

export function parseServerMessage(
  json: string,
  opts?: ParseOptions,
): ParseResult<ServerMessage> {
  return parseMessage(json, opts, "server") as ParseResult<ServerMessage>;
}

function parseMessage(
  json: string,
  opts: ParseOptions | undefined,
  direction: "client" | "server",
): ParseResult<ClientMessage | ServerMessage> {
  const overrideLimit = parseMaxBytes(opts);

  if (typeof json !== "string") {
    return failure("malformed_message", "Input must be a JSON string", "$");
  }

  const bytes = utf8ByteLength(json);
  if (overrideLimit !== undefined && bytes > overrideLimit) {
    return tooLarge(bytes, overrideLimit);
  }

  if (overrideLimit === undefined) {
    const envelopeLimit =
      direction === "client"
        ? DEFAULT_MESSAGE_SIZE_LIMITS.action_request
        : DEFAULT_MESSAGE_SIZE_LIMITS.bootstrap;
    if (bytes > envelopeLimit) {
      return tooLarge(bytes, envelopeLimit);
    }

    const wireType = peekTopLevelType(json);
    const typeLimit = defaultLimitFor(direction, wireType);
    if (typeLimit !== undefined && bytes > typeLimit) {
      return tooLarge(bytes, typeLimit);
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return failure("malformed_message", "Input is not valid JSON", "$");
  }

  const duplicateKey = findDuplicateObjectKey(json);
  if (duplicateKey !== undefined) {
    return failure(
      "malformed_message",
      `Duplicate object key ${JSON.stringify(duplicateKey)} is not allowed`,
      "$",
    );
  }

  if (!isObject(value)) {
    return failure("malformed_message", "Message root must be an object", "$");
  }

  if (value.protocolVersion !== PROTOCOL_VERSION) {
    return failure(
      "unsupported_protocol_version",
      "protocolVersion must be the number 1",
      "$.protocolVersion",
    );
  }

  if (typeof value.type !== "string") {
    return failure(
      "unknown_message_type",
      "Message type must be a recognized string",
      "$.type",
    );
  }

  const knownTypes = direction === "client" ? CLIENT_TYPES : SERVER_TYPES;
  if (!knownTypes.has(value.type)) {
    return failure(
      "unknown_message_type",
      `Unknown ${direction} message type ${JSON.stringify(value.type)}`,
      "$.type",
    );
  }

  if (overrideLimit === undefined) {
    const typeLimit = defaultLimitFor(direction, value.type);
    if (typeLimit !== undefined && bytes > typeLimit) {
      return tooLarge(bytes, typeLimit);
    }
  }

  const validationError =
    direction === "client"
      ? validateClientMessage(value)
      : validateServerMessage(value);
  if (validationError !== undefined) {
    return validationError;
  }

  return { ok: true, message: value as ClientMessage | ServerMessage };
}

function parseMaxBytes(opts: ParseOptions | undefined): number | undefined {
  if (opts === undefined) return undefined;
  if (opts === null || typeof opts !== "object") {
    throw new TypeError("opts must be an object");
  }
  if (opts.maxBytes === undefined) return undefined;
  if (!Number.isSafeInteger(opts.maxBytes) || opts.maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  return opts.maxBytes;
}

function defaultLimitFor(
  direction: "client" | "server",
  type: string | undefined,
): number | undefined {
  if (type === undefined) return undefined;
  if (direction === "client" && CLIENT_TYPES.has(type)) {
    return DEFAULT_MESSAGE_SIZE_LIMITS[
      type as keyof Pick<
        typeof DEFAULT_MESSAGE_SIZE_LIMITS,
        "hello" | "action_request" | "ping"
      >
    ];
  }
  if (direction === "server" && SERVER_TYPES.has(type)) {
    return DEFAULT_MESSAGE_SIZE_LIMITS[
      type as keyof Omit<
        typeof DEFAULT_MESSAGE_SIZE_LIMITS,
        "hello" | "action_request" | "ping"
      >
    ];
  }
  return undefined;
}

function validateClientMessage(message: JsonObject): ParseFailure | undefined {
  switch (message.type) {
    case "hello":
      return validateHello(message);
    case "action_request":
      return validateActionRequest(message);
    case "ping":
      return validateTimedMessage(message, "ping");
    default:
      return failure("unknown_message_type", "Unknown client message type", "$.type");
  }
}

function validateServerMessage(message: JsonObject): ParseFailure | undefined {
  switch (message.type) {
    case "bootstrap":
      return validateBootstrap(message);
    case "resume":
      return validateResume(message);
    case "resync_required":
      return rejectExtraKeys(message, ["type", "protocolVersion"], "$");
    case "protocol_error":
      return validateProtocolError(message);
    case "room_ended":
      return validateRoomEnded(message);
    case "ordered_action":
      return validateOrderedAction(message, "$");
    case "pong":
      return validateTimedMessage(message, "pong");
    default:
      return failure("unknown_message_type", "Unknown server message type", "$.type");
  }
}

function validateHello(message: JsonObject): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    message,
    ["type", "protocolVersion", "sessionToken", "lastSequence"],
    "$",
  );
  if (extra !== undefined) return extra;
  if (typeof message.sessionToken !== "string") {
    return wrongType("$.sessionToken", "a string");
  }
  if (
    message.lastSequence !== null &&
    !isNonNegativeSafeInteger(message.lastSequence)
  ) {
    return wrongType("$.lastSequence", "null or a non-negative safe integer");
  }
  return undefined;
}

function validateActionRequest(message: JsonObject): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    message,
    ["type", "protocolVersion", "requestId", "predictedAtSequence", "action"],
    "$",
  );
  if (extra !== undefined) return extra;
  if (typeof message.requestId !== "string") {
    return wrongType("$.requestId", "a string");
  }
  if (!isNonNegativeSafeInteger(message.predictedAtSequence)) {
    return wrongType("$.predictedAtSequence", "a non-negative safe integer");
  }
  return validateAction(message.action, "$.action");
}

function validateTimedMessage(
  message: JsonObject,
  type: "ping" | "pong",
): ParseFailure | undefined {
  const extra = rejectExtraKeys(message, ["type", "protocolVersion", "t"], "$");
  if (extra !== undefined) return extra;
  if (hasOwn(message, "t") && !isFiniteNumber(message.t)) {
    return wrongType("$.t", "a finite number");
  }
  if (message.type !== type) {
    return wrongType("$.type", JSON.stringify(type));
  }
  return undefined;
}

function validateBootstrap(message: JsonObject): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    message,
    ["type", "protocolVersion", "sequence", "snapshot", "players"],
    "$",
  );
  if (extra !== undefined) return extra;
  if (!isNonNegativeSafeInteger(message.sequence)) {
    return wrongType("$.sequence", "a non-negative safe integer");
  }
  if (hasOwn(message, "snapshot") && !isJsonValue(message.snapshot)) {
    return wrongType("$.snapshot", "a JSON value");
  }
  if (!Array.isArray(message.players)) {
    return wrongType("$.players", "an array");
  }
  for (let index = 0; index < message.players.length; index += 1) {
    const error = validatePlayerInfo(message.players[index], `$.players[${index}]`);
    if (error !== undefined) return error;
  }
  return undefined;
}

function validateResume(message: JsonObject): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    message,
    ["type", "protocolVersion", "fromSequence", "actions"],
    "$",
  );
  if (extra !== undefined) return extra;
  if (!isNonNegativeSafeInteger(message.fromSequence)) {
    return wrongType("$.fromSequence", "a non-negative safe integer");
  }
  if (!Array.isArray(message.actions)) {
    return wrongType("$.actions", "an array");
  }
  for (let index = 0; index < message.actions.length; index += 1) {
    const action = message.actions[index];
    if (!isObject(action)) {
      return wrongType(`$.actions[${index}]`, "an ordered_action object");
    }
    if (action.protocolVersion !== PROTOCOL_VERSION) {
      return failure(
        "unsupported_protocol_version",
        "protocolVersion must be the number 1",
        `$.actions[${index}].protocolVersion`,
      );
    }
    const error = validateOrderedAction(action, `$.actions[${index}]`);
    if (error !== undefined) return error;
  }
  return undefined;
}

function validateProtocolError(message: JsonObject): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    message,
    ["type", "protocolVersion", "code", "message"],
    "$",
  );
  if (extra !== undefined) return extra;
  if (typeof message.code !== "string" || !PROTOCOL_ERROR_CODES.has(message.code)) {
    return wrongType("$.code", "a recognized protocol error code");
  }
  if (typeof message.message !== "string") {
    return wrongType("$.message", "a string");
  }
  return undefined;
}

function validateRoomEnded(message: JsonObject): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    message,
    ["type", "protocolVersion", "reason"],
    "$",
  );
  if (extra !== undefined) return extra;
  if (typeof message.reason !== "string" || !ROOM_END_REASONS.has(message.reason)) {
    return wrongType("$.reason", "a recognized room-ended reason");
  }
  return undefined;
}

function validateOrderedAction(
  value: JsonObject,
  path: string,
): ParseFailure | undefined {
  const extra = rejectExtraKeys(
    value,
    [
      "type",
      "protocolVersion",
      "sequence",
      "actionId",
      "requestId",
      "actor",
      "action",
    ],
    path,
  );
  if (extra !== undefined) return extra;
  if (value.type !== "ordered_action") {
    return wrongType(`${path}.type`, '"ordered_action"');
  }
  if (!isNonNegativeSafeInteger(value.sequence)) {
    return wrongType(`${path}.sequence`, "a non-negative safe integer");
  }
  if (typeof value.actionId !== "string") {
    return wrongType(`${path}.actionId`, "a string");
  }
  if (hasOwn(value, "requestId") && typeof value.requestId !== "string") {
    return wrongType(`${path}.requestId`, "a string");
  }
  const actorError = validateActor(value.actor, `${path}.actor`);
  if (actorError !== undefined) return actorError;
  return validateAction(value.action, `${path}.action`);
}

function validateActor(value: unknown, path: string): ParseFailure | undefined {
  if (!isObject(value)) return wrongType(path, "an actor object");
  if (value.type === "player") {
    const extra = rejectExtraKeys(value, ["type", "playerId"], path);
    if (extra !== undefined) return extra;
    if (typeof value.playerId !== "string") {
      return wrongType(`${path}.playerId`, "a string");
    }
    return undefined;
  }
  if (value.type === "system") {
    return rejectExtraKeys(value, ["type"], path);
  }
  return wrongType(`${path}.type`, '"player" or "system"');
}

function validateAction(value: unknown, path: string): ParseFailure | undefined {
  if (!isObject(value)) return wrongType(path, "an action object");
  const extra = rejectExtraKeys(value, ["type", "payload"], path);
  if (extra !== undefined) return extra;
  if (typeof value.type !== "string") {
    return wrongType(`${path}.type`, "a string");
  }
  if (!hasOwn(value, "payload")) {
    return wrongType(`${path}.payload`, "a JSON value");
  }
  if (!isJsonValue(value.payload)) {
    return wrongType(`${path}.payload`, "a JSON value");
  }
  return undefined;
}

function validatePlayerInfo(value: unknown, path: string): ParseFailure | undefined {
  if (!isObject(value)) return wrongType(path, "a player object");
  const extra = rejectExtraKeys(
    value,
    ["playerId", "displayName", "seatId", "connected"],
    path,
  );
  if (extra !== undefined) return extra;
  if (typeof value.playerId !== "string") {
    return wrongType(`${path}.playerId`, "a string");
  }
  if (typeof value.displayName !== "string") {
    return wrongType(`${path}.displayName`, "a string");
  }
  if (value.seatId !== null && typeof value.seatId !== "string") {
    return wrongType(`${path}.seatId`, "a string or null");
  }
  if (typeof value.connected !== "boolean") {
    return wrongType(`${path}.connected`, "a boolean");
  }
  return undefined;
}

function rejectExtraKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
): ParseFailure | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return failure(
        "malformed_message",
        `Unknown field ${JSON.stringify(key)}`,
        joinPath(path, key),
      );
    }
  }
  return undefined;
}

function isJsonValue(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (isObject(current)) {
      for (const key of Object.keys(current)) {
        pending.push(current[key]);
      }
      continue;
    }
    return false;
  }
  return true;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function joinPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function wrongType(path: string, expected: string): ParseFailure {
  return failure(
    "malformed_message",
    `Expected ${expected} at ${path}`,
    path,
  );
}

function tooLarge(actual: number, limit: number): ParseFailure {
  return failure(
    "message_too_large",
    `Message is ${actual} UTF-8 bytes; limit is ${limit} bytes`,
  );
}

function failure(
  code: ParseErrorCode,
  detail: string,
  path?: string,
): ParseFailure {
  return path === undefined
    ? { ok: false, error: { code, detail } }
    : { ok: false, error: { code, detail, path } };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function peekTopLevelType(json: string): string | undefined {
  const containers: Array<"object" | "array"> = [];
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (char === "{") {
      containers.push("object");
      continue;
    }
    if (char === "[") {
      containers.push("array");
      continue;
    }
    if (char === "}" || char === "]") {
      containers.pop();
      continue;
    }
    if (char !== '"') continue;

    const token = readJsonString(json, index);
    if (token === undefined) return undefined;
    index = token.end;
    if (containers.length !== 1 || containers[0] !== "object") continue;

    let cursor = skipWhitespace(json, token.end + 1);
    if (json[cursor] !== ":" || token.value !== "type") continue;
    cursor = skipWhitespace(json, cursor + 1);
    if (json[cursor] !== '"') return undefined;
    return readJsonString(json, cursor)?.value;
  }
  return undefined;
}

function findDuplicateObjectKey(json: string): string | undefined {
  const containers: Array<Set<string> | null> = [];
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (char === "{") {
      containers.push(new Set<string>());
      continue;
    }
    if (char === "[") {
      containers.push(null);
      continue;
    }
    if (char === "}" || char === "]") {
      containers.pop();
      continue;
    }
    if (char !== '"') continue;

    const token = readJsonString(json, index);
    if (token === undefined) return undefined;
    index = token.end;
    const keys = containers[containers.length - 1];
    if (keys === undefined || keys === null) continue;
    const cursor = skipWhitespace(json, token.end + 1);
    if (json[cursor] !== ":") continue;
    if (keys.has(token.value)) return token.value;
    keys.add(token.value);
  }
  return undefined;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (
    value[index] === " " ||
    value[index] === "\n" ||
    value[index] === "\r" ||
    value[index] === "\t"
  ) {
    index += 1;
  }
  return index;
}

function readJsonString(
  value: string,
  start: number,
): { value: string; end: number } | undefined {
  const pieces: string[] = [];
  let chunkStart = start + 1;
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      pieces.push(value.slice(chunkStart, index));
      return { value: pieces.join(""), end: index };
    }
    if (char !== "\\") continue;

    pieces.push(value.slice(chunkStart, index));
    index += 1;
    const escape = value[index];
    if (escape === undefined) return undefined;
    if (escape === "u") {
      const hex = value.slice(index + 1, index + 5);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return undefined;
      pieces.push(String.fromCharCode(Number.parseInt(hex, 16)));
      index += 4;
    } else {
      const decoded = decodeSimpleEscape(escape);
      if (decoded === undefined) return undefined;
      pieces.push(decoded);
    }
    chunkStart = index + 1;
  }
  return undefined;
}

function decodeSimpleEscape(value: string): string | undefined {
  switch (value) {
    case '"':
    case "\\":
    case "/":
      return value;
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return undefined;
  }
}
