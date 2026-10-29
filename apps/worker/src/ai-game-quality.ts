import {
  buildRequest,
  DEFAULT_MODEL_ID,
  extractToolPayload,
  type ModelFetch,
  type ModelProfile,
  type QualityIssue,
} from "digipology-ai";
import { createSandbox } from "digipology-lua";
import { simulateDraftReport, type DraftSimulationReport } from "./ai-game-simulation";
export { simulateDraft, simulateDraftReport, type DraftSimulationReport } from "./ai-game-simulation";
import type { ReleaseBundleDto } from "digipology-protocol/http";
import { authoredRules } from "digipology-protocol";

/**
 * Quality checks for AI-generated game drafts, beyond structural validity.
 *
 * Structural validation (assembleAiGameDraft + validateUploadedBundle) proves a
 * draft is well-formed. These checks ask whether it is any good:
 *  - Lua actually compiles and runs in the Digipology sandbox (not just that
 *    the JSON parses),
 *  - the script files are wired to entities that can receive their callbacks,
 *  - Lua cross-references (settings keys, entity IDs) exist,
 *  - a simulated play session makes progress and can reach a win,
 *  - (optional, model-based) the draft follows the user's request.
 *
 * Everything here is deterministic except the optional instruction-following
 * critique, which takes an injected ModelFetch.
 */

export interface DraftQualityOptions {
  /** Creation requires a player-facing guide; archived release checks can opt out. */
  requireRules?: boolean;
  /** Legacy exploration budget: up to four actions per roll, capped at 96 per session. Default 12; 0 disables. */
  simulateRolls?: number;
  /** Optional bounded, reproducible action histories for developer review. */
  onSimulation?: (report: DraftSimulationReport) => void;
  /** Instruction budget for each sandboxed Lua execution. Default 100_000. */
  instructionBudget?: number;
  /**
   * When both are provided, a tiny focused model call checks the request
   * against the draft ("you used 2 dice, the request said 1"). Caveat: with a
   * 0.6B-class critic this hallucinates mismatches; prefer deterministic
   * checks and enable this only with a stronger model.
   */
  fetch?: ModelFetch | null;
  userPrompt?: string;
  instructionTimeoutMs?: number;
  model?: string;
  profile?: ModelProfile;
}

export async function checkDraftQuality(
  draft: ReleaseBundleDto,
  options: DraftQualityOptions = {},
): Promise<QualityIssue[]> {
  const issues: QualityIssue[] = [];
  if (options.requireRules && (authoredRules(draft)?.length ?? 0) < 40) {
    issues.push({ code: "rules_missing", severity: "error", message: "Include runtime/rules.md with a readable player guide of at least 40 characters: the objective, setup, turn choices and victory conditions. Players open it through How to play." });
  }
  issues.push(...lintLuaFiles(draft));
  issues.push(...checkLuaHasLogic(draft));
  issues.push(...checkScriptWiring(draft));
  issues.push(...checkLuaCrossReferences(draft));
  issues.push(...await checkLuaSyntax(draft, options.instructionBudget));
  const rolls = options.simulateRolls ?? 12;
  if (rolls > 0) {
    const simulation = await simulateDraftReport(draft, Math.max(1, Math.min(96, Math.trunc(rolls) * 4)), options.instructionBudget);
    issues.push(...simulation.issues);
    options.onSimulation?.(simulation);
  }
  if (options.fetch && options.userPrompt) {
    issues.push(...await critiqueInstructionFollowing({
      fetch: options.fetch,
      userPrompt: options.userPrompt,
      draft,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      ...(options.instructionTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.instructionTimeoutMs }),
    }));
  }
  return issues;
}

/** The snapshot state's shape as the quality checks need it. */
interface SnapshotStateView {
  entities: Record<string, { components: Record<string, unknown> }>;
  settings: Record<string, boolean | number | string>;
  scriptState: unknown;
}

function snapshotState(draft: ReleaseBundleDto): SnapshotStateView {
  return draft.initialSnapshot.state as unknown as SnapshotStateView;
}

// ---------------------------------------------------------------------------
// Static Lua lint
// ---------------------------------------------------------------------------

interface LuaFile {
  path: string;
  content: string;
}

function luaFiles(draft: ReleaseBundleDto): LuaFile[] {
  return draft.files
    .filter((file) => file.path.endsWith(".lua"))
    .map((file) => ({ path: file.path, content: file.content }));
}

/**
 * Strip Lua comments (short `--` and long `--[[ ]]`) without touching string
 * contents, so lint patterns don't fire on commented-out code or prose.
 */
function stripLuaComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "--") {
      if (source.startsWith("--[[", i)) {
        const end = source.indexOf("]]", i + 4);
        i = end === -1 ? n : end + 2;
      } else {
        const end = source.indexOf("\n", i);
        i = end === -1 ? n : end;
      }
      continue;
    }
    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      const end = scanString(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "[" && (source[i + 1] === "[" || source[i + 1] === "=")) {
      const end = scanLongString(source, i);
      if (end > i) {
        out += source.slice(i, end);
        i = end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function scanString(source: string, start: number): number {
  const quote = source[start]!;
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote || ch === "\n") return ch === quote ? i + 1 : i;
    i += 1;
  }
  return i;
}

function scanLongString(source: string, start: number): number {
  const match = /^\[(=*)\[/.exec(source.slice(start, start + 8));
  if (!match) return start;
  const close = `]${match[1]}]`;
  const end = source.indexOf(close, start + match[0].length);
  return end === -1 ? source.length : end + close.length;
}

const BANNED_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /(?<![\w.])math\.random(seed)?\b/,
    message:
      "uses math.random which is REMOVED from the Digipology sandbox (it is nil at runtime). " +
      "Use random:int(min, max), random:float(), or random:choice(list) instead.",
  },
  {
    pattern: /(?<![\w.])require\s*[(["']/,
    message:
      "uses require(), which does not exist in the sandbox. All game code must live in the draft's own Lua files.",
  },
  {
    pattern: /(?<![\w.])(package|io|debug)\./,
    message:
      "uses a Lua library that is not exposed to sandboxed game code (only assert, error, ipairs, pairs, string, table, math (without random), utf8, pcall, and friends are available).",
  },  {
    pattern: /(?<![\w.])(dofile|loadfile)\b/,
    message: "uses dofile/loadfile, which do not exist in the sandbox.",
  },
  {
    // `load(` but not `__load_script(` / `:load(` / `.load(` / method defs.
    pattern: /(?<![\w.:'"_])load\s*\(/,
    message:
      "uses load(), which does not exist in the sandbox. Code cannot compile new chunks at runtime.",
  },
];

function lintLuaFiles(draft: ReleaseBundleDto): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const file of luaFiles(draft)) {
    const code = stripLuaComments(file.content);
    for (const banned of BANNED_PATTERNS) {
      if (banned.pattern.test(code)) {
        issues.push({
          code: "lua_banned_global",
          message: `${file.path}: ${banned.message}`,
          severity: "error",
        });
      }
    }
    if (!/local\s+random\b/.test(code) && /(?<![\w.:'"])random\s*\(/.test(code)) {
      issues.push({
        code: "lua_banned_global",
        message:
          `${file.path}: calls a bare random() global, which does not exist in the sandbox. ` +
          "Use random:int(min, max) instead.",
        severity: "error",
      });
    }
    // The model often "fixes" math.random by inventing random_int/randint/rand.
    // None of these exist either; the deterministic API uses a colon.
    if (
      !/local\s+(random_int|randint|rand)\b/.test(code) &&
      /(?<![\w.:])(random_int|randint|rand)\s*\(/.test(code)
    ) {
      issues.push({
        code: "lua_banned_global",
        message:
          `${file.path}: calls a random_int/randint/rand global, which does not exist in the sandbox. ` +
          "The deterministic RNG API is random:int(min, max), random:float(), or random:choice(list) — note the colon.",
        severity: "error",
      });
    }
    if (/(?<![\w.])os\.(time|clock)\s*\(\s*\)/.test(code)) {
      issues.push({
        code: "lua_suspicious_time",
        message:
          `${file.path}: os.time()/os.clock() deterministically return 0 in the sandbox. ` +
          "If this is intentional (not a randomness/timing source), ignore this warning.",
        severity: "warning",
      });
    }
    for (const name of definedCallbacks(code)) {
      if (!KNOWN_CALLBACKS.has(name) && !timerCallbackNames(code).has(name)) {
        issues.push({
          code: "lua_unknown_callback",
          message:
            `${file.path}: defines ${name}(), which the kernel never calls. ` +
            `Known callbacks: ${[...KNOWN_CALLBACKS].sort().join(", ")}. ` +
            "(Timer callbacks registered via timer:after(delay, \"name\") are fine.)",
          severity: "warning",
        });
      }
    }
  }
  return issues;
}

/** Count of function definitions in comment-stripped Lua. */
function luaFunctionCount(source: string): number {
  const code = stripLuaComments(source);
  let count = 0;
  for (const _ of code.matchAll(/(?<![\w.])function\s+[A-Za-z_][A-Za-z0-9_.:]*\s*\(/g)) count += 1;
  for (const _ of code.matchAll(/(?<![\w.])=\s*function\s*\(/g)) count += 1;
  return count;
}

/**
 * Deterministic placeholder detection: no model needed. If none of the
 * draft's Lua files defines a single function, the game implements no rules.
 */
function checkLuaHasLogic(draft: ReleaseBundleDto): QualityIssue[] {
  const files = luaFiles(draft);
  if (files.length === 0) return [];
  const empty = files.filter((file) => luaFunctionCount(file.content) === 0);
  if (empty.length === 0) return [];
  const issues: QualityIssue[] = [];
  if (empty.length === files.length) {
    issues.push({
      code: "lua_no_logic",
      message:
        `None of the draft's Lua files define any functions (${files.map((file) => file.path).join(", ")} ` +
        "are comments/empty) — the game implements no rules. Write real Lua: define on_roll/on_start " +
        "callbacks that queue actions through the entity proxies.",
      severity: "error",
    });
  } else {
    for (const file of empty) {
      issues.push({
        code: "lua_empty_file",
        message: `${file.path} defines no Lua functions (comments/empty). Dead weight unless it is wired up with real code.`,
        severity: "warning",
      });
    }
  }
  return issues;
}

function definedCallbacks(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(/function\s+(on_[A-Za-z0-9_]+|can_[A-Za-z0-9_]+)\s*\(/g)) {
    names.add(match[1]!);
  }
  for (const match of code.matchAll(/(?<![\w.])(on_[A-Za-z0-9_]+|can_[A-Za-z0-9_]+)\s*=\s*function\s*\(/g)) {
    names.add(match[1]!);
  }
  return names;
}

const KNOWN_CALLBACKS = new Set([
  "on_start",
  "on_seat_claimed",
  "on_game_resumed",
  "on_player_join",
  "on_grab",
  "on_drop",
  "on_flip",
  "on_roll",
  "on_press",
  "on_enter",
  "on_leave",
  "on_container_remove",
  "on_container_add",
  "on_prompt",
  "can_grab",
  "can_drop",
  "can_flip",
  "can_press",
]);

function timerCallbackNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(/timer[.:]after\s*\([^)]*?["']([^"']+)["']/g)) {
    names.add(match[1]!);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Script wiring: files <-> entity script components <-> receivable events
// ---------------------------------------------------------------------------

interface ScriptBindingInfo {
  scriptId: string;
  bindingId: string;
  entityId: string;
  props: Record<string, unknown>;
}

function entityScriptBindings(draft: ReleaseBundleDto): ScriptBindingInfo[] {
  const result: ScriptBindingInfo[] = [];
  const entities = snapshotState(draft).entities;
  for (const [entityId, entity] of Object.entries(entities)) {
    const script = (entity as { components?: Record<string, unknown> })
      .components?.script as
      | { scriptId?: unknown; bindingId?: unknown; props?: unknown }
      | undefined;
    if (script === undefined || script === null || typeof script !== "object") continue;
    result.push({
      scriptId: typeof script.scriptId === "string" ? script.scriptId : "",
      bindingId: typeof script.bindingId === "string" ? script.bindingId : "",
      entityId,
      props:
        typeof script.props === "object" && script.props !== null && !Array.isArray(script.props)
          ? (script.props as Record<string, unknown>)
          : {},
    });
  }
  return result;
}

/**
 * Which component a bound entity needs for a callback to ever fire there.
 * die.rolled (and friends) are delivered only to bindings attached to the
 * event's entity — a script on a different entity never sees them.
 */
const CALLBACK_COMPONENT: Record<string, string> = {
  on_roll: "die",
  on_grab: "grabbable",
  on_drop: "grabbable",
  on_flip: "flippable",
  on_press: "button",
  on_enter: "zone",
  on_leave: "zone",
  on_container_add: "container",
  on_container_remove: "container",
};

function checkScriptWiring(draft: ReleaseBundleDto): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const files = luaFiles(draft);
  const bindings = entityScriptBindings(draft);
  const entities = snapshotState(draft).entities;
  const warnedCallbacks = new Set<string>();

  for (const file of files) {
    if (!file.path.startsWith("scripts/")) continue;
    if (!bindings.some((binding) => binding.scriptId === file.path)) {
      issues.push({
        code: "lua_script_unbound",
        message:
          `${file.path} is never executed: no entity has a script component with ` +
          `scriptId "${file.path}". Either wire it up or remove it.`,
        severity: "warning",
      });
    }
  }
  const scriptFiles = files.filter((file) => file.path.startsWith("scripts/"));
  if (scriptFiles.length > 0 && bindings.length === 0) {
    // Name a real file: the model copies placeholders like "<your script file>"
    // verbatim, so the suggestion must be concrete.
    const example = scriptFiles[0]!.path;
    issues.push({
      code: "lua_no_bindings",
      message:
        "The draft contains Lua scripts but NO entity has a script component, so none of the " +
        "game logic ever runs. Add a script component to the entity whose events the script " +
        "handles (e.g. the die entity, so on_roll fires when it is rolled): " +
        `{"type":"script","dataJson":"{\\"scriptId\\":\\"${example}\\",\\"bindingId\\":\\"game\\",\\"props\\":{}}"} ` +
        "(use that file, or create a new scripts/*.lua file and name it here instead).",
      severity: "error",
    });
  }
  for (const binding of bindings) {
    if (!files.some((file) => file.path === binding.scriptId)) {
      issues.push({
        code: "lua_script_missing",
        message:
          `Entity "${binding.entityId}" binds scriptId "${binding.scriptId}", but no such file is in the draft. ` +
          "Script files must live under scripts/ and end in .lua.",
        severity: "error",
      });
      continue;
    }
    if (binding.bindingId === "") {
      issues.push({
        code: "lua_binding_id_empty",
        message: `Entity "${binding.entityId}" has a script component with an empty bindingId.`,
        severity: "error",
      });
    }
    const source = files.find((file) => file.path === binding.scriptId)?.content ?? "";
    const code = stripLuaComments(source);
    for (const callback of definedCallbacks(code)) {
      const needed = CALLBACK_COMPONENT[callback];
      if (needed === undefined) continue;
      const alternatives = needed === "flippable" ? ["flippable", "card"] : [needed];
      const warningKey = `${binding.scriptId}:${callback}`;
      // One shared script can deliberately handle setup on a rules entity and
      // rolls on a die. A callback is reachable if any of that file's bindings
      // has the required component; warning on its other bindings is misleading.
      const reachable = bindings.some((candidate) => candidate.scriptId === binding.scriptId &&
        alternatives.some((type) => Object.hasOwn(entities[candidate.entityId]?.components ?? {}, type)));
      if (!reachable && !warnedCallbacks.has(warningKey)) {
        warnedCallbacks.add(warningKey);
        issues.push({
          code: "lua_callback_never_fires",
          message:
            `${binding.scriptId} defines ${callback}(), but none of its bound entities ` +
            `has a ${alternatives.join("/")} component, so the kernel never delivers that event to this script. ` +
            `Put the script component on the entity that has the ${alternatives.join("/")} component.`,
          severity: "warning",
        });
      }
    }
    for (const match of code.matchAll(/(?<![\w.])props\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!(match[1]! in binding.props)) {
        issues.push({
          code: "lua_props_mismatch",
          message:
            `${binding.scriptId} reads props.${match[1]}, but the script component on ` +
            `"${binding.entityId}" does not define that prop (has: ${Object.keys(binding.props).join(", ") || "none"}).`,
          severity: "warning",
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Lua cross-references: settings keys, entity IDs, refs
// ---------------------------------------------------------------------------

function checkLuaCrossReferences(draft: ReleaseBundleDto): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const state = snapshotState(draft);
  const settings = state.settings;
  const entityIds = new Set(Object.keys(state.entities));
  const refs = draft.refs ?? {};
  for (const file of luaFiles(draft)) {
    const code = stripLuaComments(file.content);
    for (const match of code.matchAll(/(?<![\w.])settings\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!(match[1]! in settings)) {
        issues.push({
          code: "lua_unknown_setting",
          message:
            `${file.path} reads settings.${match[1]}, but the draft defines no such setting ` +
            `(has: ${Object.keys(settings).join(", ") || "none"}). This reads as nil.`,
          severity: "error",
        });
      }
    }
    for (const match of code.matchAll(/scene\s*:\s*get\s*\(\s*(["'])((?:[^\\"'\n]|\\.)*?)\1\s*\)/g)) {
      const id = match[2]!.replace(/\\(.)/g, "$1");
      if (!entityIds.has(id)) {
        issues.push({
          code: "lua_unknown_entity",
          message:
            `${file.path} calls scene:get("${match[2]}"), but no entity with that ID exists ` +
            `(has: ${[...entityIds].join(", ") || "none"}). This returns nil and the next method call throws.`,
          severity: "error",
        });
      }
    }
    for (const match of code.matchAll(/(?<![\w.])refs\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!(match[1]! in refs)) {
        issues.push({
          code: "lua_refs_unsupported",
          message:
            `${file.path} reads refs.${match[1]}, but this draft defines no refs, so it is nil. ` +
            "Use scene:get(\"<entity-id>\") with a literal entity ID instead.",
          severity: "warning",
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Syntax check: compile each file in the real sandbox, no side effects
// ---------------------------------------------------------------------------

async function checkLuaSyntax(
  draft: ReleaseBundleDto,
  instructionBudget = 100_000,
): Promise<QualityIssue[]> {
  const files = luaFiles(draft);
  if (files.length === 0) return [];
  const issues: QualityIssue[] = [];
  const sandbox = await createSandbox({ instructionBudget, memoryBudgetBytes: 512 * 1024 });
  try {
    for (const file of files) {
      // Mirror the creator runtime's load shape (source becomes a function
      // body) without ever calling it: syntax errors surface at compile time.
      const probe = `local function __quality_syntax_check()\n${file.content}\nend\nreturn true`;
      try {
        await sandbox.run(probe);
      } catch (error) {
        const kind = (error as { kind?: string })?.kind;
        const line = (error as { line?: number })?.line;
        // The probe adds one leading line; map back to the file's line.
        const fileLine = line === undefined ? undefined : line - 1;
        const message = error instanceof Error ? error.message : String(error);
        if (kind === "syntax") {
          issues.push({
            code: "lua_syntax_error",
            message: `${file.path}: syntax error${fileLine === undefined ? "" : ` at line ${fileLine}`}: ${message}`,
            severity: "error",
          });
        } else {
          issues.push({
            code: "lua_probe_failed",
            message: `${file.path}: sandbox probe failed (${kind ?? "unknown"}): ${message}`,
            severity: "warning",
          });
        }
      }
    }
  } finally {
    sandbox.close();
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Instruction following: a tiny focused model critique call
// ---------------------------------------------------------------------------

export interface InstructionCritiqueInput {
  fetch: ModelFetch;
  model?: string;
  profile?: ModelProfile;
  userPrompt: string;
  draft: ReleaseBundleDto;
  maxTokens?: number;
  timeoutMs?: number;
}

function draftSummary(draft: ReleaseBundleDto): string {
  const state = snapshotState(draft);
  const entities = Object.entries(state.entities)
    .map(([id, entity]) => {
      const components = Object.keys(
        (entity as { components?: Record<string, unknown> }).components ?? {},
      );
      return `- ${id}: [${components.join(", ")}]`;
    })
    .join("\n");
  const files = draft.files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
  return [
    `Title: ${draft.title ?? "(untitled)"}`,
    `Players: ${draft.minPlayers}-${draft.maxPlayers} (${draft.interactionMode})`,
    `Settings: ${JSON.stringify(state.settings)}`,
    `Entities:\n${entities}`,
    `Files:\n${files}`,
  ].join("\n");
}

/**
 * Compare the user's request against the draft with a small dedicated model
 * call. This is the one quality check that needs the model: it judges
 * instruction-following ("you used 2 dice, the request said 1"), which the
 * deterministic checks cannot.
 */
export async function critiqueInstructionFollowing(
  input: InstructionCritiqueInput,
): Promise<QualityIssue[]> {
  const request = buildRequest({
    model: input.model ?? DEFAULT_MODEL_ID,
    profile: input.profile ?? "openai-compatible",
    messages: [
      {
        role: "system",
        content:
          "You are a strict requirements checker. Compare the user's game request against the " +
          "draft summary. List every concrete mismatch: wrong player count, wrong number of dice, " +
          "missing or wrong rules, wrong win condition, placeholder code where real rules were asked for. " +
          "Be specific and quote the request. Your entire message must be ONE raw JSON array of " +
          '{"code, message} objects, no prose, no markdown fences. Empty array [] when everything matches.',
      },
      {
        role: "user",
        content:
          `USER REQUEST:\n${input.userPrompt}\n\nDRAFT SUMMARY:\n${draftSummary(input.draft)}\n\n` +
          "List the mismatches as a JSON array.",
      },
    ],
    maxTokens: input.maxTokens ?? 400,
    temperature: 0.1,
  });
  let response: unknown;
  try {
    response = await input.fetch(request, input.timeoutMs ?? 60_000);
  } catch {
    return [];
  }
  if (response === null) return [];
  const parsed = extractToolPayload(response, asRecordOrArray);
  if (parsed === null) return [];
  const items = Array.isArray(parsed) ? parsed : (parsed as { issues?: unknown }).issues;
  if (!Array.isArray(items)) return [];
  const issues: QualityIssue[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.message !== "string" || record.message.trim() === "") continue;
    issues.push({
      code: typeof record.code === "string" && record.code !== "" ? record.code : "request_mismatch",
      message: record.message,
      severity: "error",
    });
  }
  return issues;
}

function asRecordOrArray(value: unknown): Record<string, unknown> | unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  return null;
}
