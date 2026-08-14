export const CSRF_HEADER = "X-Digipology-CSRF";
export const UPLOAD_BODY_LIMIT = 1024 * 1024;

export type RoomVisibility = "private" | "public";
export type GameVisibility = "public" | "unlisted";

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
  creatorHandle?: string;
  currentPlayers: number;
  totalPlays: number;
  coverVersion: number | null;
}

export interface ReleaseSummaryDto {
  releaseId: string;
  kernelVersion: number;
  luaApiVersion: number;
  releaseNumber?: number;
  createdAt?: string;
}

export interface UploadedReleaseSummaryDto {
  releaseId: string;
  releaseNumber: number;
  kernelVersion: number;
  luaApiVersion: number;
  createdAt: string;
}

export interface OwnedGameDto extends GameSummaryDto {
  builtin: false;
  visibility: GameVisibility;
  latestReleaseId: string;
  releases: UploadedReleaseSummaryDto[];
}

export interface GamesResponse {
  games: GameSummaryDto[];
}

export interface GameResponse {
  game: GameSummaryDto;
  latestRelease: ReleaseSummaryDto;
}

export interface MyGamesResponse {
  games: OwnedGameDto[];
}

export interface CreateGameRequest {
  title: string;
  tagline: string;
  slug?: string;
  minPlayers: number;
  maxPlayers: number;
  bundle: ReleaseBundleDto;
}

export interface CreateGameResponse {
  game: OwnedGameDto;
  release: UploadedReleaseSummaryDto;
}

export interface CreateReleaseRequest {
  bundle: ReleaseBundleDto;
}

export interface CreateReleaseResponse {
  release: UploadedReleaseSummaryDto;
}

export interface UpdateGameRequest {
  visibility: GameVisibility;
}

export interface UpdateGameResponse {
  game: OwnedGameDto;
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

export interface QuickPlayRequest {
  slug: string;
  displayName?: string;
}

export interface QuickPlayResponse extends JoinRoomResponse {
  joinCode: string;
}

export interface CoverUploadResponse {
  coverVersion: number;
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

export interface ReleaseFileDto {
  path: string;
  contentHash: string;
  byteLength: number;
  content: string;
}

export interface GameSnapshotDto {
  formatVersion: 1;
  kernelVersion: 1;
  releaseId: string;
  sequence: number;
  state: unknown;
  stateHash: string;
}

export interface ReleaseBundleDto {
  formatVersion: 1;
  gameId: string;
  releaseId: string;
  releaseNumber: number;
  kernelVersion: 1;
  luaApiVersion: 1;
  networkProtocolVersion: 1;
  interactionMode: "sandbox" | "scripted";
  minPlayers: number;
  maxPlayers: number;
  files: ReleaseFileDto[];
  integrity: { manifestHash: string };
  initialSnapshot: GameSnapshotDto;
  title?: string;
  definitions?: Record<string, { label?: string; color?: string }>;
}

export type ReleaseBundle = ReleaseBundleDto;

export type UploadValidationCheck =
  | "dto_shape"
  | "size"
  | "slug"
  | "canonical_json"
  | "bundle_shape"
  | "content_hashes"
  | "manifest_hash"
  | "state_hash"
  | "kernel_load"
  | "version_pins"
  | "player_limits";

export interface UploadValidationReportItem {
  check: UploadValidationCheck;
  ok: boolean;
  detail?: string;
}

export interface UploadValidationErrorResponse extends ApiErrorResponse {
  error: { code: "validation_failed"; message: string };
  report: UploadValidationReportItem[];
}

export interface ApiError {
  code: string;
  message: string;
  status?: number;
  report?: UploadValidationReportItem[];
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiError };

export type HttpValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { path: string; message: string } };

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 64;
const RELEASE_REFERENCE_MAX_LENGTH = 128;
const JOIN_CODE_INPUT_MAX_LENGTH = 32;
export const GAME_TITLE_MAX_LENGTH = 80;
export const GAME_TAGLINE_MAX_LENGTH = 240;
export const GAME_SLUG_MIN_LENGTH = 3;
export const GAME_SLUG_MAX_LENGTH = 48;

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

export function validateQuickPlayRequest(
  value: unknown,
): HttpValidationResult<QuickPlayRequest> {
  const object = exactObject(value, ["slug", "displayName"]);
  if (!object.ok) return object;
  const slug = object.value.slug;
  if (typeof slug !== "string" || !isGameSlug(slug)) {
    return invalid(
      "$.slug",
      `slug must be ${GAME_SLUG_MIN_LENGTH} to ${GAME_SLUG_MAX_LENGTH} lowercase letters, numbers, or hyphens`,
    );
  }
  const displayName = object.value.displayName;
  if (displayName !== undefined && (typeof displayName !== "string" || !isDisplayName(displayName))) {
    return invalid("$.displayName", "displayName must contain 1 to 64 characters");
  }
  return {
    ok: true,
    value: { slug, ...(displayName === undefined ? {} : { displayName }) },
  };
}

export function validateGameSummaryDto(
  value: unknown,
): HttpValidationResult<GameSummaryDto> {
  const object = exactObject(value, [
    "slug", "title", "tagline", "minPlayers", "maxPlayers", "builtin",
    "creatorHandle", "currentPlayers", "totalPlays", "coverVersion",
  ]);
  if (!object.ok) return object;
  if (typeof object.value.slug !== "string" || !isGameSlug(object.value.slug)) {
    return invalid("$.slug", "slug is invalid");
  }
  if (typeof object.value.title !== "string" || !boundedTrimmedText(object.value.title, 1, GAME_TITLE_MAX_LENGTH)) {
    return invalid("$.title", `title must contain 1 to ${GAME_TITLE_MAX_LENGTH} characters`);
  }
  if (typeof object.value.tagline !== "string" || !boundedTrimmedText(object.value.tagline, 0, GAME_TAGLINE_MAX_LENGTH)) {
    return invalid("$.tagline", `tagline must contain at most ${GAME_TAGLINE_MAX_LENGTH} characters`);
  }
  if (!isPlayerCount(object.value.minPlayers)) {
    return invalid("$.minPlayers", "minPlayers must be an integer from 1 to 64");
  }
  if (!isPlayerCount(object.value.maxPlayers) || object.value.minPlayers > object.value.maxPlayers) {
    return invalid("$.maxPlayers", "maxPlayers must be an integer from 1 to 64 and at least minPlayers");
  }
  if (typeof object.value.builtin !== "boolean") return invalid("$.builtin", "builtin must be a boolean");
  if (object.value.creatorHandle !== undefined &&
      (typeof object.value.creatorHandle !== "string" || !isDisplayName(object.value.creatorHandle))) {
    return invalid("$.creatorHandle", "creatorHandle must contain 1 to 64 characters");
  }
  if (!isNonNegativeInteger(object.value.currentPlayers)) {
    return invalid("$.currentPlayers", "currentPlayers must be a non-negative integer");
  }
  if (!isNonNegativeInteger(object.value.totalPlays)) {
    return invalid("$.totalPlays", "totalPlays must be a non-negative integer");
  }
  const coverVersion = object.value.coverVersion;
  if (coverVersion !== null &&
      (typeof coverVersion !== "number" || !Number.isSafeInteger(coverVersion) || coverVersion < 1)) {
    return invalid("$.coverVersion", "coverVersion must be null or a positive integer");
  }
  return {
    ok: true,
    value: {
      slug: object.value.slug,
      title: object.value.title,
      tagline: object.value.tagline,
      minPlayers: object.value.minPlayers,
      maxPlayers: object.value.maxPlayers,
      builtin: object.value.builtin,
      ...(object.value.creatorHandle === undefined ? {} : { creatorHandle: object.value.creatorHandle }),
      currentPlayers: object.value.currentPlayers,
      totalPlays: object.value.totalPlays,
      coverVersion,
    },
  };
}

export function validateCreateGameRequest(
  value: unknown,
): HttpValidationResult<CreateGameRequest> {
  const object = exactObject(value, [
    "title", "tagline", "slug", "minPlayers", "maxPlayers", "bundle",
  ]);
  if (!object.ok) return object;
  const title = object.value.title;
  if (typeof title !== "string" || !boundedTrimmedText(title, 1, GAME_TITLE_MAX_LENGTH)) {
    return invalid("$.title", `title must contain 1 to ${GAME_TITLE_MAX_LENGTH} characters`);
  }
  const tagline = object.value.tagline;
  if (typeof tagline !== "string" || !boundedTrimmedText(tagline, 0, GAME_TAGLINE_MAX_LENGTH)) {
    return invalid("$.tagline", `tagline must contain at most ${GAME_TAGLINE_MAX_LENGTH} characters`);
  }
  const slug = object.value.slug;
  if (slug !== undefined && (typeof slug !== "string" || !isGameSlug(slug))) {
    return invalid(
      "$.slug",
      `slug must be ${GAME_SLUG_MIN_LENGTH} to ${GAME_SLUG_MAX_LENGTH} lowercase letters, numbers, or hyphens`,
    );
  }
  const minPlayers = object.value.minPlayers;
  const maxPlayers = object.value.maxPlayers;
  if (!isPlayerCount(minPlayers)) return invalid("$.minPlayers", "minPlayers must be an integer from 1 to 64");
  if (!isPlayerCount(maxPlayers)) return invalid("$.maxPlayers", "maxPlayers must be an integer from 1 to 64");
  if (minPlayers > maxPlayers) return invalid("$.maxPlayers", "maxPlayers must be at least minPlayers");
  if (!isJsonObject(object.value.bundle)) return invalid("$.bundle", "bundle must be an object");
  return {
    ok: true,
    value: {
      title,
      tagline,
      ...(slug === undefined ? {} : { slug }),
      minPlayers,
      maxPlayers,
      bundle: object.value.bundle as unknown as ReleaseBundleDto,
    },
  };
}

export function validateCreateReleaseRequest(
  value: unknown,
): HttpValidationResult<CreateReleaseRequest> {
  const object = exactObject(value, ["bundle"]);
  if (!object.ok) return object;
  if (!isJsonObject(object.value.bundle)) return invalid("$.bundle", "bundle must be an object");
  return { ok: true, value: { bundle: object.value.bundle as unknown as ReleaseBundleDto } };
}

export function validateUpdateGameRequest(
  value: unknown,
): HttpValidationResult<UpdateGameRequest> {
  const object = exactObject(value, ["visibility"]);
  if (!object.ok) return object;
  const visibility = object.value.visibility;
  if (visibility !== "public" && visibility !== "unlisted") {
    return invalid("$.visibility", 'visibility must be "public" or "unlisted"');
  }
  return { ok: true, value: { visibility } };
}

export function isGameSlug(value: string): boolean {
  return value.length >= GAME_SLUG_MIN_LENGTH &&
    value.length <= GAME_SLUG_MAX_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function slugifyGameTitle(value: string): string {
  return value.toLowerCase().normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, GAME_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/g, "");
}

export interface ReleaseBundleValidationOptions {
  minPlayers?: number;
  maxPlayers?: number;
  canonicalStringify(value: unknown): string;
  hashValue(value: unknown): string;
  sha256(bytes: Uint8Array): Uint8Array;
  snapshotStateHash(state: unknown): string;
  loadSnapshot(value: GameSnapshotDto): unknown;
}

/** Shared browser/Worker integrity validation. It never executes bundle Lua. */
export function validateReleaseBundle(
  value: unknown,
  options: ReleaseBundleValidationOptions,
): UploadValidationReportItem[] {
  const report: UploadValidationReportItem[] = [];
  let canonical = true;
  try {
    options.canonicalStringify(value);
  } catch (error) {
    canonical = false;
    report.push(check("canonical_json", false, errorMessage(error)));
  }
  if (canonical) report.push(check("canonical_json", true));

  const shape = releaseBundleShape(value);
  report.push(check("bundle_shape", shape.ok, shape.ok ? undefined : shape.detail));
  const bundle = shape.ok ? shape.value : null;

  let contentOk = bundle !== null;
  let contentDetail: string | undefined;
  if (bundle !== null) {
    for (const file of bundle.files) {
      const bytes = encodeUtf8(file.content);
      const expectedHash = rawHash(bytes, options.sha256);
      if (bytes.byteLength !== file.byteLength || expectedHash !== file.contentHash) {
        contentOk = false;
        contentDetail = `${file.path}: expected byteLength ${bytes.byteLength} and contentHash ${expectedHash}`;
        break;
      }
    }
  }
  report.push(check("content_hashes", contentOk, contentDetail ?? (bundle === null ? "bundle shape is invalid" : undefined)));

  let manifestOk = bundle !== null;
  let manifestDetail: string | undefined;
  if (bundle !== null) {
    try {
      const expected = options.hashValue(manifestHashInput(bundle));
      manifestOk = expected === bundle.integrity.manifestHash;
      if (!manifestOk) manifestDetail = `expected ${expected}`;
    } catch (error) {
      manifestOk = false;
      manifestDetail = errorMessage(error);
    }
  }
  report.push(check("manifest_hash", manifestOk, manifestDetail ?? (bundle === null ? "bundle shape is invalid" : undefined)));

  let stateHashOk = bundle !== null;
  let stateHashDetail: string | undefined;
  if (bundle !== null) {
    try {
      const expected = options.snapshotStateHash(bundle.initialSnapshot.state);
      stateHashOk = expected === bundle.initialSnapshot.stateHash;
      if (!stateHashOk) stateHashDetail = `expected ${expected}`;
    } catch (error) {
      stateHashOk = false;
      stateHashDetail = errorMessage(error);
    }
  }
  report.push(check("state_hash", stateHashOk, stateHashDetail ?? (bundle === null ? "bundle shape is invalid" : undefined)));

  let loadOk = bundle !== null;
  let loadDetail: string | undefined;
  if (bundle !== null) {
    try {
      options.loadSnapshot(bundle.initialSnapshot);
    } catch (error) {
      loadOk = false;
      loadDetail = errorMessage(error);
    }
  }
  report.push(check("kernel_load", loadOk, loadDetail ?? (bundle === null ? "bundle shape is invalid" : undefined)));

  const versionsOk = bundle !== null && bundle.formatVersion === 1 && bundle.kernelVersion === 1 &&
    bundle.luaApiVersion === 1 && bundle.networkProtocolVersion === 1 &&
    bundle.initialSnapshot.formatVersion === 1 && bundle.initialSnapshot.kernelVersion === 1;
  report.push(check("version_pins", versionsOk, versionsOk ? undefined : "all format, kernel, Lua API, and network versions must be 1"));

  const playersOk = bundle !== null && isPlayerCount(bundle.minPlayers) && isPlayerCount(bundle.maxPlayers) &&
    bundle.minPlayers <= bundle.maxPlayers &&
    (options.minPlayers === undefined || bundle.minPlayers === options.minPlayers) &&
    (options.maxPlayers === undefined || bundle.maxPlayers === options.maxPlayers);
  report.push(check("player_limits", playersOk, playersOk ? undefined : "bundle player limits must be sane and match the game"));
  return report;
}

export function uploadReportOk(report: readonly UploadValidationReportItem[]): boolean {
  return report.every((item) => item.ok);
}

function releaseBundleShape(value: unknown):
  | { ok: true; value: ReleaseBundleDto }
  | { ok: false; detail: string } {
  const top = strictRecord(value, [
    "formatVersion", "gameId", "releaseId", "releaseNumber", "kernelVersion",
    "luaApiVersion", "networkProtocolVersion", "interactionMode", "minPlayers",
    "maxPlayers", "files", "integrity", "initialSnapshot", "title", "definitions",
  ]);
  if (!top.ok) return top;
  const object = top.value;
  if (typeof object.gameId !== "string" || object.gameId.length < 1 || object.gameId.length > 128) {
    return shapeInvalid("gameId must contain 1 to 128 characters");
  }
  if (typeof object.releaseId !== "string" || object.releaseId.length < 1 || object.releaseId.length > 128) {
    return shapeInvalid("releaseId must contain 1 to 128 characters");
  }
  if (!Number.isSafeInteger(object.releaseNumber) || (object.releaseNumber as number) < 1) {
    return shapeInvalid("releaseNumber must be a positive integer");
  }
  for (const field of ["formatVersion", "kernelVersion", "luaApiVersion", "networkProtocolVersion"] as const) {
    if (!Number.isSafeInteger(object[field])) return shapeInvalid(`${field} must be an integer`);
  }
  if (!Number.isSafeInteger(object.minPlayers) || !Number.isSafeInteger(object.maxPlayers)) {
    return shapeInvalid("minPlayers and maxPlayers must be integers");
  }
  if (object.interactionMode !== "sandbox" && object.interactionMode !== "scripted") {
    return shapeInvalid('interactionMode must be "sandbox" or "scripted"');
  }
  if (!Array.isArray(object.files) || object.files.length < 1 || object.files.length > 256) {
    return shapeInvalid("files must contain 1 to 256 entries");
  }
  const files: ReleaseFileDto[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < object.files.length; index += 1) {
    const candidate = strictRecord(object.files[index], ["path", "contentHash", "byteLength", "content"]);
    if (!candidate.ok) return shapeInvalid(`files[${index}]: ${candidate.detail}`);
    const file = candidate.value;
    if (typeof file.path !== "string" || !isReleasePath(file.path)) {
      return shapeInvalid(`files[${index}].path is invalid`);
    }
    if (paths.has(file.path)) return shapeInvalid(`duplicate file path ${file.path}`);
    paths.add(file.path);
    if (typeof file.contentHash !== "string" || !isSha256(file.contentHash)) {
      return shapeInvalid(`files[${index}].contentHash is invalid`);
    }
    if (!Number.isSafeInteger(file.byteLength) || (file.byteLength as number) < 0) {
      return shapeInvalid(`files[${index}].byteLength must be a non-negative integer`);
    }
    if (typeof file.content !== "string") return shapeInvalid(`files[${index}].content must be a string`);
    files.push({
      path: file.path,
      contentHash: file.contentHash,
      byteLength: file.byteLength as number,
      content: file.content,
    });
  }
  const integrity = strictRecord(object.integrity, ["manifestHash"]);
  if (!integrity.ok || typeof integrity.value.manifestHash !== "string" || !isSha256(integrity.value.manifestHash)) {
    return shapeInvalid("integrity.manifestHash is invalid");
  }
  const snapshotShape = strictRecord(object.initialSnapshot, [
    "formatVersion", "kernelVersion", "releaseId", "sequence", "state", "stateHash",
  ]);
  if (!snapshotShape.ok) return shapeInvalid(`initialSnapshot: ${snapshotShape.detail}`);
  const snapshotValue = snapshotShape.value as unknown as GameSnapshotDto;
  if (typeof snapshotValue.stateHash !== "string" || !isSha256(snapshotValue.stateHash) ||
      typeof snapshotValue.releaseId !== "string" || !Number.isSafeInteger(snapshotValue.sequence) ||
      !isJsonObject(snapshotValue.state)) {
    return shapeInvalid("initialSnapshot fields are invalid");
  }
  if (!Number.isSafeInteger(snapshotValue.formatVersion) || !Number.isSafeInteger(snapshotValue.kernelVersion)) {
    return shapeInvalid("initialSnapshot versions must be integers");
  }
  if (snapshotValue.sequence !== 0) return shapeInvalid("initialSnapshot sequence must be 0");
  if (snapshotValue.releaseId !== object.releaseId) return shapeInvalid("initialSnapshot releaseId must match releaseId");
  if (object.title !== undefined && (typeof object.title !== "string" || !boundedTrimmedText(object.title, 1, GAME_TITLE_MAX_LENGTH))) {
    return shapeInvalid(`title must contain 1 to ${GAME_TITLE_MAX_LENGTH} characters`);
  }
  if (object.definitions !== undefined && !validDefinitions(object.definitions)) {
    return shapeInvalid("definitions must map IDs to optional label/color strings");
  }
  return {
    ok: true,
    value: {
      formatVersion: object.formatVersion as 1,
      gameId: object.gameId,
      releaseId: object.releaseId,
      releaseNumber: object.releaseNumber as number,
      kernelVersion: object.kernelVersion as 1,
      luaApiVersion: object.luaApiVersion as 1,
      networkProtocolVersion: object.networkProtocolVersion as 1,
      interactionMode: object.interactionMode,
      minPlayers: object.minPlayers as number,
      maxPlayers: object.maxPlayers as number,
      files,
      integrity: { manifestHash: integrity.value.manifestHash },
      initialSnapshot: snapshotValue,
      ...(typeof object.title === "string" ? { title: object.title } : {}),
      ...(object.definitions === undefined ? {} : {
        definitions: object.definitions as Record<string, { label?: string; color?: string }>,
      }),
    },
  };
}

function manifestHashInput(bundle: ReleaseBundleDto): JsonObject {
  return {
    formatVersion: bundle.formatVersion,
    gameId: bundle.gameId,
    releaseId: bundle.releaseId,
    releaseNumber: bundle.releaseNumber,
    kernelVersion: bundle.kernelVersion,
    luaApiVersion: bundle.luaApiVersion,
    networkProtocolVersion: bundle.networkProtocolVersion,
    interactionMode: bundle.interactionMode,
    minPlayers: bundle.minPlayers,
    maxPlayers: bundle.maxPlayers,
    files: bundle.files.map(({ path, contentHash, byteLength }) => ({ path, contentHash, byteLength })),
  };
}

export function releaseManifestHash(
  bundle: ReleaseBundleDto,
  hash: (value: unknown) => string,
): string {
  return hash(manifestHashInput(bundle));
}

export function rawContentHash(
  content: string,
  digest: (bytes: Uint8Array) => Uint8Array,
): string {
  return rawHash(encodeUtf8(content), digest);
}

function rawHash(bytes: Uint8Array, digest: (bytes: Uint8Array) => Uint8Array): string {
  let result = "sha256:";
  for (const byte of digest(bytes)) result += byte.toString(16).padStart(2, "0");
  return result;
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else codePoint = 0xfffd;
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(
      0xe0 | (codePoint >>> 12),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
    else bytes.push(
      0xf0 | (codePoint >>> 18),
      0x80 | ((codePoint >>> 12) & 0x3f),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
  return Uint8Array.from(bytes);
}

function strictRecord(
  value: unknown,
  keys: readonly string[],
): { ok: true; value: Record<string, unknown> } | { ok: false; detail: string } {
  if (!isJsonObject(value)) return shapeInvalid("must be an object");
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return shapeInvalid(`unknown field ${key}`);
  }
  return { ok: true, value };
}

function shapeInvalid(detail: string): { ok: false; detail: string } {
  return { ok: false, detail };
}

function validDefinitions(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  for (const definition of Object.values(value)) {
    const record = strictRecord(definition, ["label", "color"]);
    if (!record.ok) return false;
    if (record.value.label !== undefined && typeof record.value.label !== "string") return false;
    if (record.value.color !== undefined && typeof record.value.color !== "string") return false;
  }
  return true;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function isReleasePath(value: string): boolean {
  if (!/^(?:runtime|scripts)\/[a-z0-9][a-z0-9._/-]{0,127}$/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isPlayerCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 64;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function boundedTrimmedText(value: string, minimum: number, maximum: number): boolean {
  if (value !== value.trim()) return false;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function check(
  name: UploadValidationCheck,
  ok: boolean,
  detail?: string,
): UploadValidationReportItem {
  return detail === undefined ? { check: name, ok } : { check: name, ok, detail };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
