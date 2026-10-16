import {
  buildRequest,
  DEFAULT_MODEL_ID,
  extractToolPayload,
  runIterativeRefinement,
  type ModelFetch,
  type QualityIssue,
  type RefinementEvent,
  type Violation,
} from "digipology-ai";
import type { ReleaseBundleDto } from "digipology-protocol/http";
import { uploadReportOk } from "digipology-protocol/http";
import {
  assembleAiGameDraft,
  authoringFromBundle,
  validReleasePath,
} from "./ai-games";
import {
  checkDraftQuality,
  type DraftQualityOptions,
} from "./ai-game-quality";
import type { CanonicalGameState } from "digipology-kernel";

/**
 * Concrete generate -> playtest -> critique -> refine loop for AI game drafts.
 *
 * The generic loop lives in digipology-ai (runIterativeRefinement); this module
 * wires it to Digipology specifics:
 *  - quality gate: checkDraftQuality (Lua sandbox execution, script wiring,
 *    simulated play, optional instruction-following critique)
 *  - refinement: a small patch request (files/entities/settings only — never a
 *    full redraft), applied through assembleAiGameDraft so structural validity
 *    is re-enforced on every iteration.
 */

export interface GameDraftPatch {
  files?: Array<{ path: string; content: string }>;
  entities?: Array<{
    id: string;
    components: Array<{ type: string; dataJson: string }>;
  }>;
  settings?: Array<{
    key: string;
    valueType: string;
    stringValue: string;
    numberValue: number;
    booleanValue: boolean;
  }>;
  scriptStateJson?: string;
}

const PATCH_KEYS = ["files", "entities", "settings", "scriptStateJson"] as const;

export interface RefineGameDraftInput {
  fetch: ModelFetch;
  /** The structurally valid draft to improve. */
  draft: ReleaseBundleDto;
  /** The user's original request text (context for refinement + critique). */
  userPrompt: string;
  maxRounds?: number;
  refinementAttempts?: number;
  /** Per-attempt timeout for refinement model calls. Default 15 min. */
  timeoutMs?: number;
  simulateRolls?: number;
  instructionBudget?: number;
  /**
   * Run the model-based instruction-following critique each round. Default
   * false: Qwen3-0.6B hallucinates mismatches (e.g. flagging a correct "2-2
   * players" as a player-count error), and bogus errors can never be fixed, so
   * they would block acceptance forever. The deterministic checks are the
   * reliable signal; enable this only with a stronger critic model.
   */
  checkInstructions?: boolean;
  instructionTimeoutMs?: number;
  onProgress?: (event: RefinementEvent) => void;
}

export interface RefineGameDraftResult {
  draft: ReleaseBundleDto | null;
  rounds: number;
  issues: QualityIssue[];
  accepted: boolean;
  refinementCalls: number;
}

/**
 * Improve an existing structurally valid draft through bounded
 * quality-check -> critique -> refine rounds.
 */
export async function refineGameDraft(
  input: RefineGameDraftInput,
): Promise<RefineGameDraftResult> {
  const qualityOptions: DraftQualityOptions = {
    ...(input.simulateRolls === undefined ? {} : { simulateRolls: input.simulateRolls }),
    ...(input.instructionBudget === undefined ? {} : { instructionBudget: input.instructionBudget }),
    ...(input.checkInstructions === true
      ? {
          fetch: input.fetch,
          userPrompt: input.userPrompt,
          ...(input.instructionTimeoutMs === undefined
            ? {}
            : { instructionTimeoutMs: input.instructionTimeoutMs }),
        }
      : {}),
  };
  // The draft already exists: "generation" is a pass-through so the pipeline
  // keeps its uniform generate -> check -> refine shape with zero model cost.
  let passthrough = true;
  const fetch: ModelFetch = async (payload, timeoutMs) => {
    if (passthrough) {
      passthrough = false;
      return { passthrough: true };
    }
    return input.fetch(payload, timeoutMs);
  };
  const result = await runIterativeRefinement<ReleaseBundleDto, GameDraftPatch>({
    fetch,
    initial: {
      request: { model: "passthrough", messages: [] },
      extract: () => input.draft,
      validate: () => [],
      maxAttempts: 1,
      timeoutMs: 1,
    },
    qualityCheck: (draft) => checkDraftQuality(draft, qualityOptions),
    // Pass all issues: errors must be fixed, warnings are secondary guidance.
    buildRefinementRequest: (draft, issues) =>
      buildGameRefinementRequest(draft, issues, input.userPrompt),
    extractRefinement,
    validateRefinement,
    applyRefinement: applyGamePatch,
    ...(input.maxRounds === undefined ? {} : { maxRounds: input.maxRounds }),
    ...(input.refinementAttempts === undefined ? {} : { refinementAttempts: input.refinementAttempts }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  });
  return {
    draft: result.value,
    rounds: result.rounds,
    issues: result.issues,
    accepted: result.accepted,
    refinementCalls: result.refinementCalls,
  };
}

const LUA_RULES = [
  "Lua sandbox rules (hostile input; ONLY this API exists):",
  "- Scripts live in scripts/*.lua. A script ONLY runs if an entity has a script component",
  '  {"type":"script","dataJson":"{\\"scriptId\\":\\"scripts/game.lua\\",\\"bindingId\\":\\"game\\",\\"props\\":{}}"}.',
  "  die.rolled calls on_roll ONLY on bindings attached to that die's own entity.",
  "- Define global functions: on_start(ctx), on_roll(ctx), on_player_join(ctx), ...",
  "  ctx holds the kernel event data: die.rolled gives ctx.entityId and ctx.value (the face).",
  "- Queue actions through entity proxies: scene:get(\"id\"):roll(), scene:get(\"id\"):add(n),",
  "  scene:get(\"id\"):set(v), scene:get(\"id\"):set(\"text\"). turns:start()/next()/current(),",
  "  scores:add(subject, n), random:int(a,b), random:float(), random:choice(list).",
  "- BANNED (nil or missing at runtime): math.random, math.randomseed, require, package, io,",
  "  debug, load, loadfile, dofile. os.time()/os.clock() always return 0.",
  "- Randomness: the ONLY way to roll dice/draw random numbers is the random namespace,",
  "  called with a COLON. Correct: local n = random:int(1, 6). Also random:float() and",
  "  random:choice(list). WRONG and nil at runtime: math.random(1,6), random(1,6),",
  "  random_int(1,6), randint(1,6). If you see 'attempt to call a nil value' mentioning",
  "  random, replace the call with random:int(min, max).",
  "- settings.X reads must match the draft's settings keys EXACTLY. scene:get(\"id\") IDs must exist.",
  "- state is persistent script state (assign fields: state.turn = 1). settings, props, scene,",
  "  players, self, definitions are read-only.",
].join("\n");

function gameState(draft: ReleaseBundleDto): CanonicalGameState {
  return draft.initialSnapshot.state as unknown as CanonicalGameState;
}

function entitySummary(draft: ReleaseBundleDto): string {
  return Object.entries(gameState(draft).entities)
    .map(([id, entity]) => {
      const components = Object.keys(
        (entity as { components?: Record<string, unknown> }).components ?? {},
      );
      return `- ${id}: [${components.join(", ")}]`;
    })
    .join("\n");
}

function bindingSummary(draft: ReleaseBundleDto): string {
  const lines: string[] = [];
  for (const [entityId, entity] of Object.entries(gameState(draft).entities)) {
    const script = (entity as { components?: Record<string, unknown> }).components?.script as
      | { scriptId?: unknown; bindingId?: unknown; props?: unknown }
      | undefined;
    if (script !== undefined && typeof script === "object" && script !== null) {
      lines.push(
        `- entity "${entityId}" -> ${String(script.scriptId)} (binding "${String(script.bindingId)}", props ${JSON.stringify(script.props ?? {})})`,
      );
    }
  }
  return lines.length === 0 ? "(none — no script is currently wired to any entity)" : lines.join("\n");
}

/**
 * A complete, working example patch for a dice game. The 0.6B model copies
 * concrete examples far more reliably than it follows abstract schemas
 * (observed: it echoed the schema documentation verbatim as values), so the
 * refinement prompt leads with this instead of a shape spec.
 */
function examplePatch(): string {
  const lua = [
    "function on_roll(ctx)",
    "  local turn = (state.turn or 0) % 2 + 1",
    "  state.turn = turn",
    "  local total = scene:get(\"score_\" .. turn).value + ctx.value",
    "  scene:get(\"score_\" .. turn):add(ctx.value)",
    "  if total >= settings.targetScore then",
    "    scene:get(\"winner\"):set(turn)",
    "  end",
    "  return true",
    "end",
  ].join("\n");
  const transform = JSON.stringify({
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const counter = JSON.stringify({ value: 0, default: 0, min: null, max: null });
  return JSON.stringify({
    files: [{ path: "scripts/game.lua", content: lua }],
    entities: [
      {
        id: "die",
        components: [
          { type: "transform", dataJson: transform },
          { type: "die", dataJson: JSON.stringify({ faces: [1, 2, 3, 4, 5, 6] }) },
          {
            type: "script",
            dataJson: JSON.stringify({ scriptId: "scripts/game.lua", bindingId: "game", props: {} }),
          },
        ],
      },
      { id: "score_1", components: [{ type: "counter", dataJson: counter }] },
      { id: "score_2", components: [{ type: "counter", dataJson: counter }] },
      { id: "winner", components: [{ type: "counter", dataJson: counter }] },
    ],
  });
}

export function buildGameRefinementRequest(
  draft: ReleaseBundleDto,
  issues: QualityIssue[],
  userPrompt: string,
): ReturnType<typeof buildRequest> {
  const files = draft.files
    .filter((file) => file.path.endsWith(".lua"))
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const format = (list: QualityIssue[]): string =>
    list.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
  const issueList = [
    "ERRORS (resolve every one):",
    errors.length === 0 ? "(none)" : format(errors),
    "",
    "WARNINGS (address the ones that indicate real problems; ignore the rest):",
    warnings.length === 0 ? "(none)" : format(warnings),
  ].join("\n");
  const system = [
    "You are fixing a Digipology game draft. Your entire message must be ONE raw JSON object",
    "(no prose, no markdown fences): a PATCH with only the keys you change.",
    'Patch keys: "files" (REQUIRED: [{path, content}] with the COMPLETE new content of every Lua',
    'file you touch — merged into the draft by path, so list only changed/new files), "entities"',
    '(optional: FULL replacement entity array), "settings" (optional: FULL replacement settings',
    'array), "scriptStateJson" (optional: replacement JSON string).',
    "",
    "EXAMPLE PATCH for a dice game like this one — copy its structure exactly, adapting the details",
    "to the issues below. Note: entities is an ARRAY of {id, components}; settings is an ARRAY of",
    "{key, valueType, stringValue, numberValue, booleanValue}:",
    examplePatch(),
    "",
    LUA_RULES,
    "",
    "Write REAL Lua code implementing the requested rules. NEVER emit placeholder text such as",
    '"<COMPLETE new content>", "-- game rules", or "-- setup".',
    "Fix the ERRORS below. Address WARNINGS where they indicate real problems. Change nothing else.",
  ].join("\n");
  const user = [
    `Original request: ${userPrompt}`,
    "",
    "Current entities (id: [components]):",
    entitySummary(draft),
    "",
    "Current settings:",
    JSON.stringify(gameState(draft).settings),
    "",
    "Current script bindings:",
    bindingSummary(draft),
    "",
    "Current Lua files:",
    files === "" ? "(no Lua files)" : files,
    "",
    "ISSUES TO FIX (resolve every one):",
    issueList,
    "",
    "Emit the patch JSON now. /no_think",
  ].join("\n");
  return buildRequest({
    model: DEFAULT_MODEL_ID,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 1500,
    temperature: 0.3,
    // Qwen3 hybrid thinking burns the token budget on reasoning instead of the patch.
    extraBody: { enable_thinking: false },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function extractRefinement(response: unknown): GameDraftPatch | null {
  const parsed = extractToolPayload(response, asRecord);
  if (parsed === null) return null;
  const keys = Object.keys(parsed);
  if (keys.length === 0 || keys.some((key) => !(PATCH_KEYS as readonly string[]).includes(key))) {
    return null;
  }
  return parsed as GameDraftPatch;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * The 0.6B model sometimes emits unambiguous shorthand: settings as
 * {key, value} instead of the full typed form, and scriptStateJson as an
 * object instead of a JSON string. Normalize those here so validation can
 * stay strict about everything else.
 */
function normalizePatch(patch: GameDraftPatch): GameDraftPatch {
  const next: GameDraftPatch = { ...patch };
  if (next.settings !== undefined) {
    next.settings = next.settings.map((setting) => {
      const record = setting as unknown as Record<string, unknown>;
      if (
        isString(record.key) &&
        !("valueType" in record) &&
        (typeof record.value === "string" ||
          typeof record.value === "number" ||
          typeof record.value === "boolean")
      ) {
        const value = record.value;
        const valueType =
          typeof value === "string" ? "string" : typeof value === "boolean" ? "boolean" : "number";
        return {
          key: record.key,
          valueType,
          stringValue: valueType === "string" ? (value as string) : "",
          numberValue: valueType === "number" ? (value as number) : 0,
          booleanValue: valueType === "boolean" ? (value as boolean) : false,
        };
      }
      return setting;
    });
  }
  if (next.scriptStateJson !== undefined && !isString(next.scriptStateJson)) {
    try {
      next.scriptStateJson = JSON.stringify(next.scriptStateJson);
    } catch {
      // Leave it; validateRefinement will flag it.
    }
  }
  return next;
}

export function validateRefinement(patch: GameDraftPatch): Violation[] {
  const violations: Violation[] = [];
  if (patch.files !== undefined) {
    if (!Array.isArray(patch.files) || patch.files.length === 0) {
      violations.push({ code: "patch_shape", message: "files must be a non-empty array" });
    } else {
      patch.files.forEach((file, index) => {
        if (!isRecord(file) || !isString(file.path) || !isString(file.content)) {
          violations.push({ code: "patch_shape", message: `files[${index}] needs string path and content` });
        } else if (!file.path.endsWith(".lua") || !validReleasePath(file.path)) {
          violations.push({ code: "patch_shape", message: `files[${index}] has an invalid Lua path: ${file.path}` });
        }
      });
    }
  }
  if (patch.entities !== undefined) {
    if (!Array.isArray(patch.entities)) {
      violations.push({ code: "patch_shape", message: "entities must be an array" });
    } else {
      patch.entities.forEach((entity, index) => {
        if (!isRecord(entity) || !isString(entity.id) || entity.id === "" || !Array.isArray(entity.components)) {
          violations.push({ code: "patch_shape", message: `entities[${index}] needs a non-empty id and components array` });
        } else {
          entity.components.forEach((component, componentIndex) => {
            if (!isRecord(component) || !isString(component.type) || !isString(component.dataJson)) {
              violations.push({
                code: "patch_shape",
                message: `entities[${index}].components[${componentIndex}] needs string type and dataJson`,
              });
            }
          });
        }
      });
    }
  }
  if (patch.settings !== undefined) {
    if (!Array.isArray(patch.settings)) {
      violations.push({ code: "patch_shape", message: "settings must be an array" });
    } else {
      patch.settings.forEach((setting, index) => {
        const record = setting as unknown as Record<string, unknown>;
        const shorthand =
          isString(record.key) && record.key !== "" && "value" in record && !("valueType" in record) &&
          (typeof record.value === "string" ||
            (typeof record.value === "number" && Number.isFinite(record.value)) ||
            typeof record.value === "boolean");
        if (shorthand) return; // {key, value}; normalized in applyGamePatch.
        if (
          !isString(record.key) || record.key === "" ||
          !["string", "number", "boolean"].includes(record.valueType as string) ||
          !isString(record.stringValue) ||
          typeof record.numberValue !== "number" || !Number.isFinite(record.numberValue) ||
          typeof record.booleanValue !== "boolean"
        ) {
          violations.push({ code: "patch_shape", message: `settings[${index}] has invalid typed fields` });
        }
      });
    }
  }
  if (patch.scriptStateJson !== undefined) {
    if (!isString(patch.scriptStateJson)) {
      // An object/array is fine; normalizePatch stringifies it.
      try {
        JSON.stringify(patch.scriptStateJson);
      } catch {
        violations.push({ code: "patch_shape", message: "scriptStateJson must be valid JSON" });
      }
    } else {
      try {
        JSON.parse(patch.scriptStateJson);
      } catch {
        violations.push({ code: "patch_shape", message: "scriptStateJson must be valid JSON" });
      }
    }
  }
  return violations;
}

/**
 * Merge a validated patch into the draft's authorable surface and re-assemble,
 * so structural validity (schema, kernel load, upload checks) is re-enforced
 * on every refinement iteration.
 */
export function applyGamePatch(
  draft: ReleaseBundleDto,
  patch: GameDraftPatch,
): ReleaseBundleDto | null {
  const normalized = normalizePatch(patch);
  const authoring = authoringFromBundle(draft) as unknown as Record<string, unknown>;
  if (normalized.files !== undefined) {
    // Merge by path: the patch carries only the files it touches; every other
    // draft file is kept. (A full-replacement semantic would silently drop any
    // file the model didn't re-emit.)
    const byPath = new Map<string, string>();
    for (const file of draft.files) byPath.set(file.path, file.content);
    for (const file of normalized.files) byPath.set(file.path, file.content);
    authoring["files"] = [...byPath].map(([path, content]) => ({ path, content }));
  }
  if (normalized.entities !== undefined) authoring["entities"] = normalized.entities;
  if (normalized.settings !== undefined) authoring["settings"] = normalized.settings;
  if (normalized.scriptStateJson !== undefined) authoring["scriptStateJson"] = normalized.scriptStateJson;
  const { draft: next, report } = assembleAiGameDraft(authoring, {
    gameId: draft.gameId,
    releaseId: draft.releaseId,
    releaseNumber: draft.releaseNumber,
    title: draft.title ?? "Untitled game",
    minPlayers: draft.minPlayers,
    maxPlayers: draft.maxPlayers,
  });
  if (next === null || !uploadReportOk(report)) return null;
  return next;
}

/** Console progress logging so a multi-minute refinement is not a black box. */
export function logRefinementProgress(event: RefinementEvent): void {
  switch (event.type) {
    case "generation":
      if (event.event.type === "attempt_started") {
        console.log(`refine: generation attempt ${event.event.attempt}/${event.event.maxAttempts} started`);
      } else {
        console.log(
          `refine: generation attempt ${event.event.attempt} finished in ${event.event.elapsedMs}ms: ${event.event.outcome}`,
        );
      }
      break;
    case "round_started":
      console.log(`refine: round ${event.round}/${event.maxRounds} quality check started`);
      break;
    case "quality_checked":
      console.log(
        `refine: round ${event.round} quality: ${event.issues.length} issue(s) ` +
        `(${event.issues.filter((issue) => issue.severity === "error").length} errors)`,
      );
      for (const issue of event.issues) {
        console.log(`  - [${issue.severity}] ${issue.code}: ${issue.message.slice(0, 160)}`);
      }
      break;
    case "refinement_started":
      console.log(`refine: round ${event.round} refinement attempt ${event.attempt}/${event.maxAttempts} started`);
      break;
    case "refinement_finished":
      console.log(
        `refine: round ${event.round} attempt ${event.attempt} finished in ${event.elapsedMs}ms: ${event.outcome}` +
        (event.violations.length === 0 ? "" : ` (${event.violations.length} violations)`),
      );
      break;
    case "refinement_done":
      console.log(`refine: done after ${event.rounds} round(s), accepted=${event.accepted}`);
      break;
  }
}
