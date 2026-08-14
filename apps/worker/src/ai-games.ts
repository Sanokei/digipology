import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import {
  BOOL,
  DEFAULT_DEEPSEEK_MODEL,
  NUM,
  STR,
  buildRequest,
  dayKey,
  extractToolPayload,
  makeDeepseekFetch,
  responseUsd,
  runStructuredTask,
  type DeepseekFetch,
  type DeepSeekRequest,
  type DeepSeekTool,
  type Violation,
} from "digipology-ai";
import {
  componentRegistry,
  createInitialState,
  defaultActionRegistry,
  snapshot,
  type CanonicalGameState,
  type EntityComponents,
  type EntityRecord,
  type JsonValue,
  type Settings,
} from "digipology-kernel";
import {
  rawContentHash,
  releaseManifestHash,
  uploadReportOk,
  validateCreateAiGameRequest,
  validateEditAiGameRequest,
  type AiGameDraftResponse,
  type AiGameGenerationErrorResponse,
  type ReleaseBundleDto,
  type UploadValidationReportItem,
} from "digipology-protocol/http";
import type { AuthenticatedSession } from "./auth";
import { builtinCatalog } from "./catalog";
import {
  type D1Repositories,
  type UploadedGameRecord,
} from "./d1-repositories";
import { FixedWindowRateLimiter } from "./rate-limiter";
import { validateUploadedBundle } from "./release-validation";

const AI_RATE_LIMIT = 20;
const AI_RATE_WINDOW_MS = 60 * 60 * 1000;
const AI_BODY_LIMIT = 64 * 1024;
const AI_TOOL_NAME = "emit_game_bundle_draft";
const DRAFT_RNG_ALGORITHM = "sfc32-v1";
const ACTION_REFERENCE = /\b(?:system|entity|deck|die|counter)\.[a-z][a-z0-9_]*\b/g;
const RELEASE_PATH = /^(?:runtime|scripts)\/[a-z0-9][a-z0-9._/-]{0,127}$/;

const enumString = (values: readonly string[], description: string) => ({
  ...STR(description),
  enum: [...values],
});

const strictObject = (
  properties: Record<string, unknown>,
  required: readonly string[],
) => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

const fileSchema = strictObject({
  path: {
    ...STR("UTF-8 file path under runtime/ or scripts/."),
    pattern: "^(runtime|scripts)/[a-z0-9][a-z0-9._/-]{0,127}$",
  },
  content: STR("Complete UTF-8 file content. Never emit hashes or byte lengths."),
}, ["path", "content"]);

const settingSchema = strictObject({
  key: STR("Stable setting key."),
  valueType: enumString(["string", "number", "boolean"], "Which typed value is active."),
  stringValue: STR("String value, or an empty string when another type is active."),
  numberValue: NUM("Finite numeric value, or 0 when another type is active."),
  booleanValue: BOOL("Boolean value, or false when another type is active."),
}, ["key", "valueType", "stringValue", "numberValue", "booleanValue"]);

const componentSchema = strictObject({
  type: enumString(Object.keys(componentRegistry).sort(), "A registered kernel component type."),
  dataJson: STR("A JSON object containing the component fields documented by the kernel type."),
}, ["type", "dataJson"]);

const entitySchema = strictObject({
  id: STR("Stable non-empty entity ID."),
  components: {
    type: "array",
    minItems: 1,
    items: componentSchema,
    description: "Registered semantic components for this entity.",
  },
}, ["id", "components"]);

const definitionSchema = strictObject({
  id: STR("Stable definition ID."),
  label: STR("Plain-text display label, or an empty string."),
  color: STR("Plain-text color value, or an empty string."),
}, ["id", "label", "color"]);

/** Strict forced-function schema for the model-owned, authorable surface only. */
export const AI_GAME_TOOL: DeepSeekTool = {
  type: "function",
  function: {
    name: AI_TOOL_NAME,
    description: "Emit a complete authorable Digipology game draft. The server adds IDs, hashes, and the initial snapshot.",
    parameters: strictObject({
      title: { ...STR("Plain-text game title, 1 to 80 characters."), minLength: 1, maxLength: 80 },
      tagline: { ...STR("Plain-text one-sentence tagline, at most 240 characters."), maxLength: 240 },
      interactionMode: enumString(["sandbox", "scripted"], "Game interaction mode."),
      minPlayers: { ...NUM("Integer player minimum from 1 through 64."), minimum: 1, maximum: 64, multipleOf: 1 },
      maxPlayers: { ...NUM("Integer player maximum from 1 through 64."), minimum: 1, maximum: 64, multipleOf: 1 },
      files: { type: "array", minItems: 1, maxItems: 256, items: fileSchema },
      settings: { type: "array", items: settingSchema },
      entities: { type: "array", items: entitySchema },
      scriptStateJson: STR("Canonical JSON seed for persistent script state."),
      rngSeed: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { ...NUM("Unsigned 32-bit deterministic RNG seed word."), minimum: 0, maximum: 0xffff_ffff, multipleOf: 1 },
      },
      definitions: { type: "array", items: definitionSchema },
    }, [
      "title", "tagline", "interactionMode", "minPlayers", "maxPlayers",
      "files", "settings", "entities", "scriptStateJson", "rngSeed", "definitions",
    ]),
  },
};

export interface AiGameDependencies {
  /** Tests inject a hermetic port. Omit to construct the production DeepSeek port. */
  deepseekFetch?: DeepseekFetch | null;
}

export interface AiGameRouteInput {
  request: Request;
  env: Env;
  repositories: D1Repositories;
  session: AuthenticatedSession;
  now: number;
  mode: "create" | "edit";
  slug?: string;
  dependencies?: AiGameDependencies;
}

interface AssemblyContext {
  gameId?: string;
  releaseId?: string;
  releaseNumber?: number;
  title?: string;
  minPlayers?: number;
  maxPlayers?: number;
}

interface AssemblyResult {
  draft: ReleaseBundleDto | null;
  report: UploadValidationReportItem[];
}

interface UsageRow {
  usd: number;
}

export async function handleAiGameRequest(input: AiGameRouteInput): Promise<Response> {
  const ownedGame = input.mode === "edit"
    ? await ownedGameForEdit(input.repositories, input.slug, input.session.user.id)
    : null;
  if (ownedGame instanceof Response) return ownedGame;

  const deepseekFetch = resolveDeepseekFetch(input.env, input.dependencies);
  if (deepseekFetch === null) {
    return jsonError(503, "ai_unconfigured", "AI creation isn't set up on this server yet");
  }

  const usageDay = dayKey(new Date(input.now));
  const cap = dailyCap(input.env);
  if (await usageAtOrAboveCap(input.env.DB, input.session.user.id, usageDay, cap)) {
    return dailyCapResponse();
  }

  const limiter = new FixedWindowRateLimiter(input.repositories, AI_RATE_LIMIT, AI_RATE_WINDOW_MS);
  const rate = await limiter.consume(`ai-game:user:${input.session.user.id}`, input.now);
  if (!rate.allowed) {
    return jsonError(429, "rate_limited", "Too many AI draft requests; try again later", {
      "Retry-After": String(rate.retryAfterSeconds),
    });
  }

  let prompt: string;
  try {
    const body = await readAiJson(input.request);
    const parsed = input.mode === "create"
      ? validateCreateAiGameRequest(body)
      : validateEditAiGameRequest(body);
    if (!parsed.ok) return jsonError(400, "invalid_request", parsed.error.message);
    prompt = "prompt" in parsed.value ? parsed.value.prompt : parsed.value.instruction;
  } catch {
    return jsonError(400, "invalid_request", "Request body must be valid JSON");
  }

  let existingBundle: ReleaseBundleDto | null = null;
  if (ownedGame !== null) {
    const bucket = releaseBucket(input.env);
    if (bucket === null) {
      return jsonError(503, "release_storage_unavailable", "Release storage is unavailable");
    }
    const object = await bucket.get(`releases/${ownedGame.latestReleaseId}.json`);
    if (object === null) return jsonError(404, "not_found", "Latest game release not found");
    try {
      existingBundle = await object.json<ReleaseBundleDto>();
    } catch {
      return jsonError(502, "release_bundle_invalid", "The latest release bundle could not be read");
    }
  }

  const assemblyContext: AssemblyContext = ownedGame === null ? {} : {
    gameId: ownedGame.id,
    releaseId: draftReleaseId(ownedGame.slug, nextReleaseNumber(existingBundle)),
    releaseNumber: nextReleaseNumber(existingBundle),
    title: ownedGame.title,
    minPlayers: ownedGame.minPlayers,
    maxPlayers: ownedGame.maxPlayers,
  };
  const request = buildAiRequest(input.env, input.mode, prompt, existingBundle);
  let lastAssembly: AssemblyResult = failedAssembly("The model did not emit a usable draft");
  let capReached = false;
  const meteredFetch: DeepseekFetch = async (payload, timeoutMs) => {
    if (capReached || await usageAtOrAboveCap(
      input.env.DB,
      input.session.user.id,
      usageDay,
      cap,
    )) {
      capReached = true;
      return null;
    }
    const response = await deepseekFetch(payload, timeoutMs);
    if (response !== null) {
      await recordUsage(input.env.DB, input.session.user.id, usageDay, responseUsd(response));
    }
    return response;
  };

  const task = await runStructuredTask<Record<string, unknown>>({
    fetch: meteredFetch,
    request,
    maxAttempts: 3,
    extract: (response) => extractToolPayload(response, asRecord),
    validate: (authoring) => {
      lastAssembly = assembleAiGameDraft(authoring, assemblyContext);
      return reportViolations(lastAssembly.report);
    },
  });

  if (task.result !== null && lastAssembly.draft !== null && uploadReportOk(lastAssembly.report)) {
    const response: AiGameDraftResponse = {
      draft: lastAssembly.draft,
      validationReport: lastAssembly.report,
      telemetry: task.telemetry,
    };
    return jsonResponse(response);
  }
  if (capReached) return dailyCapResponse();

  const response: AiGameGenerationErrorResponse = {
    error: {
      code: "ai_generation_failed",
      message: "AI could not produce a valid game draft after three attempts. Review the checks and retry.",
    },
    validationReport: lastAssembly.report,
    telemetry: task.telemetry,
  };
  return jsonResponse(response, 502);
}

function buildAiRequest(
  env: Env,
  mode: "create" | "edit",
  prompt: string,
  existingBundle: ReleaseBundleDto | null,
): DeepSeekRequest {
  const reference = builtinCatalog.getRelease("builtin_dice_dash_2")?.bundle;
  const referenceText = reference === undefined
    ? ""
    : `\nREFERENCE AUTHORABLE BUNDLE:\n${canonicalStringify(authoringFromBundle(reference))}`;
  const current = existingBundle === null
    ? ""
    : `\nCURRENT SERVER-LOADED AUTHORABLE BUNDLE:\n${canonicalStringify(authoringFromBundle(existingBundle))}`;
  const actions = defaultActionRegistry.types().join(", ");
  const components = Object.keys(componentRegistry).sort().map((type) => {
    const requires = componentRegistry[type]?.requires ?? [];
    return `${type}${requires.length === 0 ? "" : ` (requires ${requires.join(", ")})`}`;
  }).join(", ");
  const system = [
    "You create valid Digipology release drafts through the forced tool only.",
    "The tool schema is the authorable bundle surface; never emit IDs, hashes, byte lengths, integrity, or snapshots.",
    `Registered kernel actions only: ${actions}.`,
    `Registered components only: ${components}.`,
    "Component dataJson and scriptStateJson must be strict finite JSON with no comments.",
    "Transforms use position{x,y,z}, normalized rotation{x,y,z,w}, and positive scale{x,y,z}.",
    "Lua files are hostile-input sandbox code. Available standard globals are assert, error, getmetatable, ipairs, next, pairs, rawequal, rawget, rawlen, rawset, select, setmetatable, tonumber, tostring, type, string, table, math, utf8, pcall, xpcall, and collectgarbage('count').",
    "Lua math.random and math.randomseed are removed; os.time() and os.clock() deterministically return 0. There is no require, package, io, debug, loadfile, dofile, network, filesystem, timers, or JS interop.",
    "Files must stay under runtime/ or scripts/. Use only registered action names in JSON or Lua.",
    referenceText,
  ].join("\n");
  const user = mode === "create"
    ? `Create a complete playable game draft from this description:\n${prompt}`
    : `Edit the current game according to this instruction and emit the complete replacement draft:\n${prompt}${current}`;
  return buildRequest({
    model: configuredString(env, "DEEPSEEK_MODEL", DEFAULT_DEEPSEEK_MODEL),
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    tool: {
      name: AI_GAME_TOOL.function.name,
      description: AI_GAME_TOOL.function.description,
      properties: AI_GAME_TOOL.function.parameters.properties as Record<string, unknown>,
      required: AI_GAME_TOOL.function.parameters.required as string[],
    },
    maxTokens: 16_000,
    temperature: 0.35,
  });
}

export function assembleAiGameDraft(
  raw: Record<string, unknown>,
  context: AssemblyContext = {},
): AssemblyResult {
  const normalized = normalizeAuthoring(raw);
  if (!normalized.ok) return failedAssembly(normalized.detail);

  const authoring = normalized.value;
  const title = context.title ?? authoring.title;
  const base = slugToken(title);
  const gameId = context.gameId ?? `draft_${base}`;
  const releaseNumber = context.releaseNumber ?? 1;
  const releaseId = context.releaseId ?? `draft_${base}_${releaseNumber}`;
  const files = authoring.files.map((file) => ({
    ...file,
    byteLength: new TextEncoder().encode(file.content).byteLength,
    contentHash: rawContentHash(file.content, sha256),
  }));

  let state: CanonicalGameState;
  try {
    state = createInitialState({
      releaseId,
      rng: { algorithm: DRAFT_RNG_ALGORITHM, state: authoring.rngSeed, draws: 0 },
      settings: authoring.settings,
      seats: generatedSeats(authoring.maxPlayers, authoring.entities),
      entities: authoring.entities,
      scriptState: authoring.scriptState,
    });
  } catch (error) {
    return failedAssembly(errorMessage(error), "kernel_load");
  }

  const draft: ReleaseBundleDto = {
    formatVersion: 1,
    gameId,
    releaseId,
    releaseNumber,
    kernelVersion: 1,
    luaApiVersion: 1,
    networkProtocolVersion: 1,
    interactionMode: authoring.interactionMode,
    minPlayers: authoring.minPlayers,
    maxPlayers: authoring.maxPlayers,
    files,
    integrity: { manifestHash: "sha256:" + "0".repeat(64) },
    initialSnapshot: snapshot(state) as unknown as ReleaseBundleDto["initialSnapshot"],
    title,
    ...(Object.keys(authoring.definitions).length === 0 ? {} : { definitions: authoring.definitions }),
  };
  draft.integrity.manifestHash = releaseManifestHash(draft, hashValue);
  const report = validateUploadedBundle(
    draft,
    context.minPlayers ?? authoring.minPlayers,
    context.maxPlayers ?? authoring.maxPlayers,
  );
  const unsupportedAction = firstUnsupportedAction(files.map((file) => file.content));
  if (unsupportedAction !== null) {
    failCheck(report, "bundle_shape", `unregistered action ${unsupportedAction}`);
  }
  return { draft, report };
}

interface NormalizedAuthoring {
  title: string;
  tagline: string;
  interactionMode: "sandbox" | "scripted";
  minPlayers: number;
  maxPlayers: number;
  files: Array<{ path: string; content: string }>;
  settings: Settings;
  entities: Record<string, EntityRecord>;
  scriptState: JsonValue;
  rngSeed: [number, number, number, number];
  definitions: Record<string, { label?: string; color?: string }>;
}

function normalizeAuthoring(raw: Record<string, unknown>):
  | { ok: true; value: NormalizedAuthoring }
  | { ok: false; detail: string } {
  const allowed = [
    "title", "tagline", "interactionMode", "minPlayers", "maxPlayers", "files",
    "settings", "entities", "scriptStateJson", "rngSeed", "definitions",
  ];
  const unknown = Object.keys(raw).find((key) => !allowed.includes(key));
  if (unknown !== undefined) return invalidAuthoring(`unknown authorable field ${unknown}`);
  const title = boundedText(raw.title, 1, 80);
  const tagline = boundedText(raw.tagline, 0, 240);
  if (title === null) return invalidAuthoring("title must contain 1 to 80 trimmed characters");
  if (tagline === null) return invalidAuthoring("tagline must contain at most 240 trimmed characters");
  if (raw.interactionMode !== "sandbox" && raw.interactionMode !== "scripted") {
    return invalidAuthoring("interactionMode must be sandbox or scripted");
  }
  const minPlayers = playerCount(raw.minPlayers);
  const maxPlayers = playerCount(raw.maxPlayers);
  if (minPlayers === null || maxPlayers === null || minPlayers > maxPlayers) {
    return invalidAuthoring("player limits must be integers from 1 to 64 with minPlayers <= maxPlayers");
  }
  const files = normalizeFiles(raw.files);
  if (!files.ok) return files;
  const settings = normalizeSettings(raw.settings);
  if (!settings.ok) return settings;
  const entities = normalizeEntities(raw.entities);
  if (!entities.ok) return entities;
  const scriptState = parseCanonicalJson(raw.scriptStateJson, "scriptStateJson");
  if (!scriptState.ok) return scriptState;
  const rngSeed = normalizeRngSeed(raw.rngSeed);
  if (!rngSeed.ok) return rngSeed;
  const definitions = normalizeDefinitions(raw.definitions);
  if (!definitions.ok) return definitions;
  return { ok: true, value: {
    title,
    tagline,
    interactionMode: raw.interactionMode,
    minPlayers,
    maxPlayers,
    files: files.value,
    settings: settings.value,
    entities: entities.value,
    scriptState: scriptState.value,
    rngSeed: rngSeed.value,
    definitions: definitions.value,
  } };
}

function normalizeFiles(value: unknown): Result<Array<{ path: string; content: string }>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    return invalidAuthoring("files must contain 1 to 256 entries");
  }
  const paths = new Set<string>();
  const files: Array<{ path: string; content: string }> = [];
  for (const candidate of value) {
    const file = exactRecord(candidate, ["path", "content"]);
    if (file === null || typeof file.path !== "string" || typeof file.content !== "string" ||
        !validReleasePath(file.path) || paths.has(file.path)) {
      return invalidAuthoring("each file needs a unique valid runtime/ or scripts/ path and string content");
    }
    paths.add(file.path);
    files.push({ path: file.path, content: file.content });
  }
  return { ok: true, value: files };
}

function normalizeSettings(value: unknown): Result<Settings> {
  if (!Array.isArray(value)) return invalidAuthoring("settings must be an array");
  const settings: Settings = {};
  for (const candidate of value) {
    const setting = exactRecord(candidate, ["key", "valueType", "stringValue", "numberValue", "booleanValue"]);
    if (setting === null || typeof setting.key !== "string" || setting.key.length === 0 || setting.key in settings) {
      return invalidAuthoring("settings need unique non-empty keys and exact typed fields");
    }
    if (setting.valueType === "string" && typeof setting.stringValue === "string") settings[setting.key] = setting.stringValue;
    else if (setting.valueType === "number" && typeof setting.numberValue === "number" && Number.isFinite(setting.numberValue)) settings[setting.key] = setting.numberValue;
    else if (setting.valueType === "boolean" && typeof setting.booleanValue === "boolean") settings[setting.key] = setting.booleanValue;
    else return invalidAuthoring(`setting ${setting.key} has an invalid typed value`);
  }
  return { ok: true, value: settings };
}

function normalizeEntities(value: unknown): Result<Record<string, EntityRecord>> {
  if (!Array.isArray(value)) return invalidAuthoring("entities must be an array");
  const entities: Record<string, EntityRecord> = {};
  for (const candidate of value) {
    const entity = exactRecord(candidate, ["id", "components"]);
    if (entity === null || typeof entity.id !== "string" || entity.id.length === 0 || entity.id in entities || !Array.isArray(entity.components)) {
      return invalidAuthoring("entities need unique non-empty IDs and a components array");
    }
    const components: EntityComponents = {};
    for (const componentCandidate of entity.components) {
      const component = exactRecord(componentCandidate, ["type", "dataJson"]);
      if (component === null || typeof component.type !== "string" || !(component.type in componentRegistry) || component.type in components) {
        return invalidAuthoring(`entity ${entity.id} contains an unregistered or duplicate component`);
      }
      const parsed = parseCanonicalJson(component.dataJson, `component ${component.type}`);
      if (!parsed.ok || !isRecord(parsed.value)) return invalidAuthoring(`component ${component.type} dataJson must contain a JSON object`);
      components[component.type] = parsed.value;
    }
    for (const type of Object.keys(components)) {
      for (const required of componentRegistry[type]?.requires ?? []) {
        if (!(required in components)) return invalidAuthoring(`${type} on ${entity.id} requires ${required}`);
      }
    }
    entities[entity.id] = { id: entity.id, components };
  }
  return { ok: true, value: entities };
}

function normalizeDefinitions(value: unknown): Result<Record<string, { label?: string; color?: string }>> {
  if (!Array.isArray(value)) return invalidAuthoring("definitions must be an array");
  const definitions: Record<string, { label?: string; color?: string }> = {};
  for (const candidate of value) {
    const definition = exactRecord(candidate, ["id", "label", "color"]);
    if (definition === null || typeof definition.id !== "string" || definition.id.length === 0 ||
        typeof definition.label !== "string" || typeof definition.color !== "string" || definition.id in definitions) {
      return invalidAuthoring("definitions need unique IDs plus string label and color fields");
    }
    definitions[definition.id] = {
      ...(definition.label === "" ? {} : { label: definition.label }),
      ...(definition.color === "" ? {} : { color: definition.color }),
    };
  }
  return { ok: true, value: definitions };
}

function normalizeRngSeed(value: unknown): Result<[number, number, number, number]> {
  if (!Array.isArray(value) || value.length !== 4 || value.some((word) =>
    !Number.isSafeInteger(word) || (word as number) < 0 || (word as number) > 0xffff_ffff)) {
    return invalidAuthoring("rngSeed must contain four unsigned 32-bit integers");
  }
  return { ok: true, value: [value[0] as number, value[1] as number, value[2] as number, value[3] as number] };
}

type Result<T> = { ok: true; value: T } | { ok: false; detail: string };

function invalidAuthoring(detail: string): { ok: false; detail: string } {
  return { ok: false, detail };
}

function parseCanonicalJson(value: unknown, label: string): Result<JsonValue> {
  if (typeof value !== "string") return invalidAuthoring(`${label} must be a JSON string`);
  try {
    const parsed = JSON.parse(value) as unknown;
    canonicalStringify(parsed);
    return { ok: true, value: parsed as JsonValue };
  } catch (error) {
    return invalidAuthoring(`${label}: ${errorMessage(error)}`);
  }
}

function generatedSeats(maxPlayers: number, entities: Record<string, EntityRecord>): CanonicalGameState["seats"] {
  const seats: CanonicalGameState["seats"] = {};
  for (let index = 1; index <= maxPlayers; index += 1) {
    const id = `seat_${index}`;
    const hand = Object.values(entities).find((entity) =>
      (entity.components.hand as { owner?: unknown } | undefined)?.owner === id);
    seats[id] = { id, playerId: null, ...(hand === undefined ? {} : { handId: hand.id }) };
  }
  return seats;
}

function failedAssembly(detail: string, target: "bundle_shape" | "kernel_load" = "bundle_shape"): AssemblyResult {
  const report = validateUploadedBundle(null, 1, 1);
  failCheck(report, target, detail);
  return { draft: null, report };
}

function failCheck(
  report: UploadValidationReportItem[],
  check: UploadValidationReportItem["check"],
  detail: string,
): void {
  const item = report.find((candidate) => candidate.check === check);
  if (item !== undefined) Object.assign(item, { ok: false, detail });
}

function reportViolations(report: readonly UploadValidationReportItem[]): Violation[] {
  return report.filter((item) => !item.ok).map((item) => ({
    code: item.check,
    message: item.detail ?? `${item.check} failed`,
  }));
}

function firstUnsupportedAction(contents: readonly string[]): string | null {
  const supported = new Set(defaultActionRegistry.types());
  for (const content of contents) {
    for (const match of content.matchAll(ACTION_REFERENCE)) {
      const action = match[0];
      if (!supported.has(action)) return action;
    }
  }
  return null;
}

/** Convert a real bundle into exactly the tool's authorable representation. */
export function authoringFromBundle(bundle: ReleaseBundleDto): Record<string, unknown> {
  const state = bundle.initialSnapshot.state as CanonicalGameState;
  return {
    title: bundle.title ?? "Untitled game",
    tagline: "",
    interactionMode: bundle.interactionMode,
    minPlayers: bundle.minPlayers,
    maxPlayers: bundle.maxPlayers,
    files: bundle.files.map(({ path, content }) => ({ path, content })),
    settings: Object.keys(state.settings).sort().map((key) => {
      const value = state.settings[key]!;
      return {
        key,
        valueType: typeof value,
        stringValue: typeof value === "string" ? value : "",
        numberValue: typeof value === "number" ? value : 0,
        booleanValue: typeof value === "boolean" ? value : false,
      };
    }),
    entities: Object.keys(state.entities).sort().map((id) => ({
      id,
      components: Object.keys(state.entities[id]!.components).sort().map((type) => ({
        type,
        dataJson: canonicalStringify(state.entities[id]!.components[type]),
      })),
    })),
    scriptStateJson: canonicalStringify(state.scriptState),
    rngSeed: [...state.rng.state],
    definitions: Object.keys(bundle.definitions ?? {}).sort().map((id) => ({
      id,
      label: bundle.definitions?.[id]?.label ?? "",
      color: bundle.definitions?.[id]?.color ?? "",
    })),
  };
}

async function ownedGameForEdit(
  repositories: D1Repositories,
  slug: string | undefined,
  userId: string,
): Promise<UploadedGameRecord | Response> {
  if (slug === undefined) return jsonError(404, "not_found", "Game not found");
  const game = await repositories.getUploadedGame(slug);
  if (game === null) return jsonError(404, "not_found", "Game not found");
  if (game.ownerUserId !== userId) {
    return jsonError(403, "forbidden", "Only the game owner can edit with AI");
  }
  return game;
}

function resolveDeepseekFetch(env: Env, dependencies: AiGameDependencies | undefined): DeepseekFetch | null {
  if (dependencies !== undefined && Object.prototype.hasOwnProperty.call(dependencies, "deepseekFetch")) {
    return dependencies.deepseekFetch ?? null;
  }
  return makeDeepseekFetch({ apiKey: configuredString(env, "DEEPSEEK_API_KEY", "") || undefined });
}

function dailyCap(env: Env): number {
  const parsed = Number(configuredString(env, "AI_DAILY_USD_CAP", "1"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

async function usageAtOrAboveCap(
  db: D1Database,
  userId: string,
  day: string,
  cap: number,
): Promise<boolean> {
  const row = await db.prepare(
    "SELECT usd FROM deepseek_usage WHERE user_id = ? AND day = ?",
  ).bind(userId, day).first<UsageRow>();
  return (row?.usd ?? 0) >= cap;
}

export async function recordUsage(
  db: D1Database,
  userId: string,
  day: string,
  usd: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO deepseek_usage (user_id, day, usd) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET usd = deepseek_usage.usd + excluded.usd`,
  ).bind(userId, day, Number.isFinite(usd) && usd > 0 ? usd : 0).run();
}

function configuredString(env: Env, key: string, fallback: string): string {
  const value = Reflect.get(env, key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

async function readAiJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > AI_BODY_LIMIT) {
    throw new RangeError("AI request body is too large");
  }
  if (request.body === null) throw new TypeError("AI request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > AI_BODY_LIMIT) {
      await reader.cancel();
      throw new RangeError("AI request body is too large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function releaseBucket(env: Env): R2Bucket | null {
  const value = Reflect.get(env, "RELEASES");
  return value !== null && typeof value === "object" ? value as R2Bucket : null;
}

function dailyCapResponse(): Response {
  return jsonError(
    429,
    "ai_daily_cap",
    "You've reached today's AI creation limit. It resets at UTC midnight.",
  );
}

function nextReleaseNumber(bundle: ReleaseBundleDto | null): number {
  return (bundle?.releaseNumber ?? 0) + 1;
}

function draftReleaseId(slug: string, releaseNumber: number): string {
  return `draft_${slug}_${releaseNumber}`;
}

function slugToken(value: string): string {
  const token = value.toLowerCase().normalize("NFKD").replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "").slice(0, 64).replaceAll(/_+$/g, "");
  return token === "" ? "ai_game" : token;
}

function playerCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 64
    ? value as number
    : null;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum ? value : null;
}

function validReleasePath(value: string): boolean {
  return RELEASE_PATH.test(value) && value.split("/").every((segment) =>
    segment !== "" && segment !== "." && segment !== "..");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record === null || Object.keys(record).some((key) => !keys.includes(key)) ||
      keys.some((key) => !(key in record))) return null;
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function jsonError(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
