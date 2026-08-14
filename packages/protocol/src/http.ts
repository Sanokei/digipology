export type RoomVisibility = "private" | "public";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface RequestMagicLinkRequest {
  email: string;
}

export interface UpdateMeRequest {
  name: string;
}

export interface MeResponse {
  user: UserDto | null;
}

export interface UserResponse {
  user: UserDto;
}

export interface GameSummaryDto {
  slug: string;
  title: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  builtin: boolean;
}

export interface ReleaseSummaryDto {
  releaseId: string;
  kernelVersion: number;
  luaApiVersion: number;
}

export interface GamesResponse {
  games: GameSummaryDto[];
}

export interface GameResponse {
  game: GameSummaryDto;
  latestRelease: ReleaseSummaryDto;
}

export interface CreateRoomRequest {
  releaseSlugOrId: string;
  visibility: RoomVisibility;
  displayName?: string;
}

export interface CreateRoomResponse {
  roomId: string;
  joinCode: string;
  inviteUrl: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
}

export interface JoinRoomRequest {
  code: string;
  displayName?: string;
}

export interface JoinRoomResponse {
  roomId: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
  releaseId: string;
}

export interface PublicRoomDto {
  joinCode: string;
  gameTitle: string;
  players: number;
  maxPlayers: number;
  createdAt: string;
}

export interface PublicRoomsResponse {
  rooms: PublicRoomDto[];
}

export type ReleaseBundle = JsonObject;

export type HttpValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { path: string; message: string } };

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 64;
const RELEASE_REFERENCE_MAX_LENGTH = 128;
const JOIN_CODE_INPUT_MAX_LENGTH = 32;

export function validateRequestMagicLinkRequest(
  value: unknown,
): HttpValidationResult<RequestMagicLinkRequest> {
  const object = exactObject(value, ["email"]);
  if (!object.ok) return object;
  if (
    typeof object.value.email !== "string" ||
    object.value.email.length > EMAIL_MAX_LENGTH ||
    !isEmail(object.value.email)
  ) {
    return invalid("$.email", "email must be a valid address of at most 254 characters");
  }
  return { ok: true, value: { email: object.value.email } };
}

export function validateUpdateMeRequest(
  value: unknown,
): HttpValidationResult<UpdateMeRequest> {
  const object = exactObject(value, ["name"]);
  if (!object.ok) return object;
  const name = object.value.name;
  if (typeof name !== "string" || !isDisplayName(name)) {
    return invalid("$.name", "name must contain 1 to 64 characters");
  }
  return { ok: true, value: { name } };
}

export function validateCreateRoomRequest(
  value: unknown,
): HttpValidationResult<CreateRoomRequest> {
  const object = exactObject(value, ["releaseSlugOrId", "visibility", "displayName"]);
  if (!object.ok) return object;
  const releaseSlugOrId = object.value.releaseSlugOrId;
  if (
    typeof releaseSlugOrId !== "string" ||
    releaseSlugOrId.trim().length === 0 ||
    releaseSlugOrId.length > RELEASE_REFERENCE_MAX_LENGTH
  ) {
    return invalid(
      "$.releaseSlugOrId",
      "releaseSlugOrId must contain 1 to 128 characters",
    );
  }
  const visibility = object.value.visibility;
  if (visibility !== "private" && visibility !== "public") {
    return invalid("$.visibility", 'visibility must be "private" or "public"');
  }
  const displayName = object.value.displayName;
  if (displayName !== undefined && (typeof displayName !== "string" || !isDisplayName(displayName))) {
    return invalid("$.displayName", "displayName must contain 1 to 64 characters");
  }
  return {
    ok: true,
    value: {
      releaseSlugOrId,
      visibility,
      ...(displayName === undefined ? {} : { displayName }),
    },
  };
}

export function validateJoinRoomRequest(
  value: unknown,
): HttpValidationResult<JoinRoomRequest> {
  const object = exactObject(value, ["code", "displayName"]);
  if (!object.ok) return object;
  const code = object.value.code;
  if (
    typeof code !== "string" ||
    code.trim().length === 0 ||
    code.length > JOIN_CODE_INPUT_MAX_LENGTH
  ) {
    return invalid("$.code", "code must contain 1 to 32 characters");
  }
  const displayName = object.value.displayName;
  if (displayName !== undefined && (typeof displayName !== "string" || !isDisplayName(displayName))) {
    return invalid("$.displayName", "displayName must contain 1 to 64 characters");
  }
  return {
    ok: true,
    value: { code, ...(displayName === undefined ? {} : { displayName }) },
  };
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
): HttpValidationResult<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("$", "request body must be an object");
  }
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) return invalid(`$.${key}`, `unknown field ${key}`);
  }
  return { ok: true, value: object };
}

function isEmail(value: string): boolean {
  if (value !== value.trim() || /\s/.test(value)) return false;
  const separator = value.lastIndexOf("@");
  return separator > 0 && separator < value.length - 1 && value.slice(separator + 1).includes(".");
}

function isDisplayName(value: string): boolean {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= NAME_MAX_LENGTH;
}

function invalid<T>(path: string, message: string): HttpValidationResult<T> {
  return { ok: false, error: { path, message } };
}
