import { canonicalStringify } from "digipology-canonical-json";
import {
  buildRequest,
  DEFAULT_MODEL_ID,
  extractToolPayload,
  type ModelFetch,
  type QualityIssue,
} from "digipology-ai";
import {
  applyOrderedWithScripts,
  seedInitialRoster,
  loadSnapshot,
  type CanonicalGameState,
  type GameSnapshot,
  type OrderedActionInput,
} from "digipology-kernel";
import {
  createCreatorScriptRuntime,
  createSandbox,
  scriptsFromReleaseFiles,
} from "digipology-lua";
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
  /** Simulated die rolls in the playtest. Default 12. 0 disables simulation. */
  simulateRolls?: number;
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
  if (rolls > 0) issues.push(...await simulateDraft(draft, rolls, options.instructionBudget));
  if (options.fetch && options.userPrompt) {
    issues.push(...await critiqueInstructionFollowing({
      fetch: options.fetch,
      userPrompt: options.userPrompt,
      draft,
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
// Dynamic simulation: actually play the draft through kernel + Lua runtime
// ---------------------------------------------------------------------------

export interface DraftSimulation {
  issues: QualityIssue[];
  rollsApplied: number;
  progressObserved: boolean;
  winObserved: boolean;
}

function progressFingerprint(state: CanonicalGameState): string {
  const counters: Record<string, unknown> = {};
  const texts: Record<string, unknown> = {};
  for (const [id, entity] of Object.entries(state.entities)) {
    const components = entity.components as Record<string, { value?: unknown; default?: unknown } | undefined>;
    const counter = components.counter;
    if (counter !== undefined && counter.value !== undefined) counters[id] = counter.value;
    const text = components.text;
    if (text !== undefined && text.value !== undefined) texts[id] = text.value;
    const die = components.die;
    if (die !== undefined && die.value !== undefined) counters[`die:${id}`] = die.value;
  }
  return canonicalStringify({ counters, texts, scriptState: state.scriptState });
}

function winnerDeclared(state: CanonicalGameState): boolean {
  for (const [id, entity] of Object.entries(state.entities)) {
    if (!/winner/i.test(id)) continue;
    const components = entity.components as Record<string, { value?: unknown; default?: unknown } | undefined>;
    const counter = components.counter;
    if (counter !== undefined && counter.value !== counter.default) return true;
    const text = components.text;
    if (text !== undefined && text.value !== "") return true;
  }
  const scriptState = state.scriptState;
  if (typeof scriptState === "object" && scriptState !== null && !Array.isArray(scriptState)) {
    const winner = (scriptState as Record<string, unknown>).winner_id ?? (scriptState as Record<string, unknown>).winner;
    if (winner !== undefined && winner !== null && winner !== 0 && winner !== "" && winner !== false) {
      return true;
    }
  }
  return false;
}

function scriptErrorIssues(events: Array<{ type: string; data?: unknown }>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "script.error") continue;
    const data = (event.data ?? {}) as {
      script?: unknown; binding?: unknown; function?: unknown;
      line?: unknown; message?: unknown; kind?: unknown;
    };
    const key = `${data.script}|${data.function}|${data.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let message = String(data.message ?? "unknown error");
    // Point the model at the right API when it invents a random global.
    if (/nil value/i.test(message) && /random/i.test(message)) {
      message += " Did you mean random:int(min, max)? The sandbox has no math.random, random(), random_int(), or randint() — only random:int, random:float, and random:choice.";
    }
    issues.push({
      code: "lua_runtime_error",
      message:
        `Lua ${String(data.function ?? "?")} in ${String(data.script ?? "?")} failed at runtime` +
        (typeof data.line === "number" ? ` (line ${data.line})` : "") +
        `: ${message}. ` +
        "The triggering action was rejected, so this breaks the game flow.",
      severity: "error",
    });
  }
  return issues;
}

function nextAction(
  sequence: number,
  actionId: string,
  type: string,
  actor: OrderedActionInput["actor"],
  payload: Record<string, unknown>,
): OrderedActionInput {
  return {
    sequence,
    actionId,
    actor,
    action: { type, payload: payload as never },
  };
}

/**
 * Join simulated players, then roll every die and watch what happens:
 * script errors, state progress, and whether a win is ever declared.
 * Deterministic: kernel RNG comes from the draft's own seed.
 */
export async function simulateDraft(
  draft: ReleaseBundleDto,
  rolls = 12,
  instructionBudget = 100_000,
): Promise<QualityIssue[]> {
  const scripts = scriptsFromReleaseFiles(draft.files);
  if (Object.keys(scripts).length === 0) return [];
  const issues: QualityIssue[] = [];
  const runtime = await createCreatorScriptRuntime({ scripts, instructionBudget, memoryBudgetBytes: 512 * 1024, refs: draft.refs ?? {}, definitions: draft.definitions ?? {} });
  try {
    const initial = loadSnapshot(draft.initialSnapshot as unknown as GameSnapshot);
    const roster = [];

    const playerCount = Math.min(Math.max(draft.minPlayers, 1), 4);
    const playerIds: string[] = [];
    const allEvents: Array<{ type: string; data?: unknown }> = [];
    for (let index = 1; index <= playerCount; index += 1) {
      const playerId = `sim_player_${index}`;
      playerIds.push(playerId);
      roster.push({ playerId, name: `Player ${index}`, seatId: `seat_${index}` });
    }
    // Live rooms place their initial roster in the sequence-zero snapshot,
    // then run game_start once. Joining first would make game_start invalid.
    let state = seedInitialRoster(initial, roster);
    const started = await applyOrderedWithScripts(state, nextAction(1, "sim-start", "system.game_start", { type: "system" }, {}), { runtime });
    state = started.state;
    let sequence = state.sequence;
    allEvents.push(...started.events);

    const dice = Object.entries(state.entities)
      .filter(([, entity]) =>
        (entity.components as Record<string, unknown>).die !== undefined)
      .map(([id]) => id);
    if (dice.length === 0) return scriptErrorIssues(allEvents);

    let progressObserved = false;
    let winObserved = winnerDeclared(state);
    let before = progressFingerprint(state);
    let rollsApplied = 0;
    for (let round = 1; round <= rolls; round += 1) {
      for (const dieId of dice) {
        sequence += 1;
        const script = typeof state.scriptState === "object" && state.scriptState !== null && !Array.isArray(state.scriptState) ? state.scriptState : {};
        const stdlib = typeof script.__stdlib === "object" && script.__stdlib !== null && !Array.isArray(script.__stdlib) ? script.__stdlib : {};
        const turns = typeof stdlib.turns === "object" && stdlib.turns !== null && !Array.isArray(stdlib.turns) ? stdlib.turns : {};
        const current = turns.active === true && Array.isArray(turns.order) && typeof turns.index === "number" ? turns.order[turns.index - 1] : null;
        const actor = {
          type: "player",
          playerId: typeof current === "string" ? current : playerIds[(round - 1) % playerIds.length]!,
        } as const;
        const result = await applyOrderedWithScripts(
          state,
          nextAction(sequence, `sim-roll-${round}-${dieId}`, "die.roll", actor, { entityId: dieId }),
          { runtime },
        );
        allEvents.push(...result.events);
        state = result.state;
        rollsApplied += 1;
        const after = progressFingerprint(state);
        if (after !== before) progressObserved = true;
        before = after;
        if (!winObserved && winnerDeclared(state)) winObserved = true;
        if (winObserved) break;
      }
      if (winObserved) break;
    }
    // Dedup across the whole session: one broken callback failing every roll
    // is one issue, not N.
    issues.push(...scriptErrorIssues(allEvents));

    if (rollsApplied > 0 && !progressObserved && !issues.some((issue) => issue.severity === "error")) {
      issues.push({
        code: "game_no_progress",
        message:
          `${rollsApplied} simulated die roll(s) changed nothing observable (no counter, text, ` +
          "die value, or script state moved). The game does not react to its own actions.",
        severity: "warning",
      });
    }
    const targetSetting = Object.keys(state.settings).find((key) => /target|goal|win|score/i.test(key));
    if (targetSetting !== undefined && !winObserved && rollsApplied > 0) {
      issues.push({
        code: "game_win_unobserved",
        message:
          `The draft has a target-like setting ("${targetSetting}") but no winner was declared ` +
          `during ${rollsApplied} simulated roll(s). The win condition may be unreachable or unimplemented.`,
        severity: "warning",
      });
    }
    return issues;
  } finally {
    runtime.close();
  }
}

// ---------------------------------------------------------------------------
// Instruction following: a tiny focused model critique call
// ---------------------------------------------------------------------------

export interface InstructionCritiqueInput {
  fetch: ModelFetch;
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
    model: DEFAULT_MODEL_ID,
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
          "List the mismatches as a JSON array. /no_think",
      },
    ],
    maxTokens: input.maxTokens ?? 400,
    temperature: 0.1,
    extraBody: { enable_thinking: false },
  });
  let response: unknown;
  try {
    response = await input.fetch(request, input.timeoutMs ?? 300_000);
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
