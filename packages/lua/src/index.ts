import { LuaFactory } from "wasmoon";

export type LuaValue =
  | null
  | boolean
  | number
  | string
  | LuaValue[]
  | { [key: string]: LuaValue };

export interface SandboxOptions {
  instructionBudget: number;
  memoryBudgetBytes?: number;
  env?: Record<string, unknown>;
}

export interface Sandbox {
  run(code: string, env?: Record<string, unknown>): Promise<LuaValue>;
  close(): void;
}

export type LuaErrorKind =
  | "runtime"
  | "syntax"
  | "budget_exceeded"
  | "memory_exceeded"
  | "extraction";

export class LuaError extends Error {
  readonly kind: LuaErrorKind;
  readonly line?: number;
  readonly script?: string;

  constructor(
    kind: LuaErrorKind,
    message: string,
    details: { line?: number; script?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "LuaError";
    this.kind = kind;
    if (details.line !== undefined) this.line = details.line;
    if (details.script !== undefined) this.script = details.script;
  }
}

const LUA_OK = 0;
const LUA_ERRSYNTAX = 3;
const LUA_ERRMEM = 4;
const LUA_MASKCOUNT = 8;
const LUA_REGISTRYINDEX = -1_001_000;
const LUA_TNIL = 0;
const LUA_TBOOLEAN = 1;
const LUA_TNUMBER = 3;
const LUA_TSTRING = 4;
const LUA_TTABLE = 5;
const LUA_TFUNCTION = 6;
const LUA_TUSERDATA = 7;
const LUA_TTHREAD = 8;
const CHUNK_NAME = "sandbox";
const MAX_HOOK_INTERVAL = 100;
const LUA_MEMORY_ERROR = "not enough memory";

const LOCKDOWN = `
local original = _G
local raw_collectgarbage = collectgarbage
local raw_pcall = pcall
local raw_xpcall = xpcall
local raw_tostring = tostring
local memory_abort = __digipology_memory_abort
local unpack = table.unpack

local function copy(source)
  local target = {}
  for key, value in original.next, source do target[key] = value end
  return target
end

local safe_string = copy(string)
local safe_table = copy(table)
local safe_math = copy(math)
local safe_utf8 = copy(utf8)
safe_math.random = nil
safe_math.randomseed = nil

debug.setmetatable("", { __index = safe_string, __metatable = "locked" })

local function checked_results(results)
  if not results[1] and original.type(results[2]) == "string"
      and results[2] == "${LUA_MEMORY_ERROR}" then
    memory_abort()
  end
  return unpack(results, 1, results.n)
end

local safe = {
  _VERSION = _VERSION,
  assert = assert,
  error = error,
  getmetatable = getmetatable,
  ipairs = ipairs,
  next = next,
  pairs = pairs,
  rawequal = rawequal,
  rawget = rawget,
  rawlen = rawlen,
  rawset = rawset,
  select = select,
  setmetatable = setmetatable,
  tonumber = tonumber,
  type = type,
  string = safe_string,
  table = safe_table,
  math = safe_math,
  utf8 = safe_utf8,
  os = { time = function() return 0 end, clock = function() return 0 end },
}

safe.tostring = function(value)
  local kind = original.type(value)
  if kind == "table" then return "<table>" end
  if kind == "function" then return "<function>" end
  if kind == "userdata" then return "<userdata>" end
  if kind == "thread" then return "<thread>" end
  return raw_tostring(value)
end

safe.collectgarbage = function(option)
  if option ~= "count" then error("collectgarbage only permits 'count'", 2) end
  return raw_collectgarbage("count")
end

safe.pcall = function(fn, ...)
  return checked_results(original.table.pack(raw_pcall(fn, ...)))
end

safe.xpcall = function(fn, handler, ...)
  return checked_results(original.table.pack(raw_xpcall(fn, handler, ...)))
end

safe._G = safe
return safe
`;

class BudgetAbort extends Error {}
class MemoryAbort extends Error {}

interface EmscriptenModuleLike {
  addFunction(fn: (...args: number[]) => number | void, signature: string): number;
  removeFunction(pointer: number): void;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPU8: Uint8Array;
  getValue(pointer: number, type: string): number;
  _lua_pushlstring(state: number, string: number, length: number): number;
  _lua_tolstring(state: number, index: number, length: number): number;
}

interface LuaApi {
  module: EmscriptenModuleLike;
  lua_absindex(state: number, index: number): number;
  lua_createtable(state: number, arrayCount: number, recordCount: number): void;
  lua_error(state: number): number;
  lua_gettop(state: number): number;
  lua_isinteger(state: number, index: number): number;
  luaL_ref(state: number, table: number): number;
  lua_next(state: number, index: number): number;
  lua_newuserdatauv(state: number, size: number, userValues: number): number;
  lua_pcallk(
    state: number,
    args: number,
    results: number,
    errorFunction: number,
    context: number,
    continuation: number | null,
  ): number;
  lua_pushboolean(state: number, value: number): void;
  lua_pushcclosure(state: number, pointer: number, upvalues: number): void;
  lua_pushinteger(state: number, value: bigint): void;
  lua_pushnil(state: number): void;
  lua_pushnumber(state: number, value: number): void;
  lua_pushvalue(state: number, index: number): void;
  lua_rawgeti(state: number, table: number, reference: bigint): number;
  lua_rawset(state: number, index: number): void;
  lua_rawseti(state: number, index: number, key: bigint): void;
  lua_rawequal(state: number, first: number, second: number): number;
  lua_sethook(
    state: number,
    hook: number | null,
    mask: number,
    count: number,
  ): void;
  lua_setmetatable(state: number, index: number): number;
  lua_setupvalue(state: number, functionIndex: number, upvalue: number): string;
  lua_settop(state: number, index: number): void;
  lua_toboolean(state: number, index: number): number;
  lua_tointegerx(state: number, index: number, isNumber: number | null): bigint;
  lua_tonumberx(state: number, index: number, isNumber: number | null): number;
  lua_topointer(state: number, index: number): number;
  lua_type(state: number, index: number): number;
}

interface LuaGlobalLike {
  readonly address: number;
  readonly lua: LuaApi;
  close(): void;
  getMemoryUsed(): number;
  loadString(code: string, name?: string): void;
  setMemoryMax(maximum: number | undefined): void;
}

interface LuaEngineLike {
  readonly global: LuaGlobalLike;
}

interface LuaFactoryLike {
  createEngine(options: {
    enableProxy: boolean;
    injectObjects: boolean;
    openStandardLibs: boolean;
    traceAllocations: boolean;
  }): Promise<LuaEngineLike>;
  getLuaModule(): Promise<unknown>;
}

interface RunContext {
  readonly api: LuaApi;
  readonly state: number;
  readonly functionPointers: number[];
  readonly nullPointer: number;
  readonly nullReference: number;
}

export async function createSandbox(opts: SandboxOptions): Promise<Sandbox> {
  assertPositiveInteger(opts.instructionBudget, "instructionBudget");
  if (opts.memoryBudgetBytes !== undefined) {
    assertPositiveInteger(opts.memoryBudgetBytes, "memoryBudgetBytes");
  }
  const baseEnvironment = snapshotEnvironment(opts.env, "env");
  const factory = new LuaFactory() as unknown as LuaFactoryLike;
  await factory.getLuaModule();

  let closed = false;
  let running = false;
  let activeEngine: LuaEngineLike | undefined;

  return {
    async run(code: string, env?: Record<string, unknown>): Promise<LuaValue> {
      if (closed) throw new LuaError("runtime", "Sandbox is closed");
      if (running) {
        throw new LuaError("runtime", "Concurrent run() calls are not supported");
      }
      if (typeof code !== "string") {
        throw new TypeError("code must be a string");
      }

      const runEnvironment = snapshotEnvironment(env, "run env");
      running = true;
      let engine: LuaEngineLike | undefined;
      const functionPointers: number[] = [];
      let hookPointer: number | undefined;

      try {
        engine = await factory.createEngine({
          enableProxy: false,
          injectObjects: false,
          openStandardLibs: true,
          traceAllocations: true,
        });
        activeEngine = engine;
        if (closed) throw new LuaError("runtime", "Sandbox is closed");

        const global = engine.global;
        const api = global.lua;
        const state = global.address;
        const memoryAbortPointer = api.module.addFunction(() => {
          throw new MemoryAbort("Lua memory budget exceeded");
        }, "ii");
        functionPointers.push(memoryAbortPointer);
        api.lua_pushcclosure(state, memoryAbortPointer, 0);
        setGlobal(api, state, "__digipology_memory_abort");

        const environmentReference = runLockdown(global);
        const nullReference = createNullSentinel(api, state);
        api.lua_rawgeti(state, LUA_REGISTRYINDEX, BigInt(nullReference));
        const nullPointer = api.lua_topointer(state, -1);
        pop(api, state);

        if (opts.memoryBudgetBytes !== undefined) {
          global.setMemoryMax(global.getMemoryUsed() + opts.memoryBudgetBytes);
        }

        const context: RunContext = {
          api,
          state,
          functionPointers,
          nullPointer,
          nullReference,
        };

        api.lua_rawgeti(state, LUA_REGISTRYINDEX, BigInt(environmentReference));
        const environmentIndex = api.lua_absindex(state, -1);
        injectEnvironment(context, environmentIndex, baseEnvironment);
        injectEnvironment(context, environmentIndex, runEnvironment);
        pushString(api, state, "_G");
        api.lua_pushvalue(state, environmentIndex);
        api.lua_rawset(state, environmentIndex);
        pop(api, state);

        try {
          global.loadString(code, CHUNK_NAME);
        } catch (cause) {
          throw normalizeError("syntax", cause);
        }

        const functionIndex = api.lua_absindex(state, -1);
        api.lua_rawgeti(state, LUA_REGISTRYINDEX, BigInt(environmentReference));
        const upvalueName = api.lua_setupvalue(state, functionIndex, 1);
        if (upvalueName !== "_ENV") {
          throw new LuaError("runtime", "Unable to install the sandbox environment");
        }

        const hookInterval = Math.min(MAX_HOOK_INTERVAL, opts.instructionBudget);
        let consumed = 0;
        hookPointer = api.module.addFunction(() => {
          consumed += hookInterval;
          if (consumed >= opts.instructionBudget) {
            throw new BudgetAbort("Lua instruction budget exceeded");
          }
        }, "vii");
        functionPointers.push(hookPointer);
        api.lua_sethook(state, hookPointer, LUA_MASKCOUNT, hookInterval);

        let status: number;
        try {
          status = api.lua_pcallk(state, 0, 1, 0, 0, null);
        } catch (cause) {
          if (cause instanceof BudgetAbort) {
            throw new LuaError(
              "budget_exceeded",
              `Lua instruction budget of ${opts.instructionBudget} exceeded`,
              { script: CHUNK_NAME, cause },
            );
          }
          if (cause instanceof MemoryAbort) {
            throw new LuaError("memory_exceeded", "Lua memory budget exceeded", {
              script: CHUNK_NAME,
              cause,
            });
          }
          throw normalizeError("runtime", cause);
        } finally {
          api.lua_sethook(state, null, 0, 0);
        }

        if (status !== LUA_OK) {
          const message = luaErrorMessage(api, state);
          const kind =
            status === LUA_ERRMEM
              ? "memory_exceeded"
              : status === LUA_ERRSYNTAX
                ? "syntax"
                : "runtime";
          throw makeLuaError(kind, message);
        }

        try {
          return extractValue(context, -1, new Set<number>());
        } catch (cause) {
          if (cause instanceof LuaError) throw cause;
          throw new LuaError("extraction", errorMessage(cause), {
            script: CHUNK_NAME,
            cause,
          });
        }
      } catch (cause) {
        if (cause instanceof LuaError) throw cause;
        if (cause instanceof MemoryAbort) {
          throw new LuaError("memory_exceeded", "Lua memory budget exceeded", {
            script: CHUNK_NAME,
            cause,
          });
        }
        throw normalizeError("runtime", cause);
      } finally {
        if (engine !== undefined) {
          if (hookPointer !== undefined) {
            try {
              engine.global.lua.lua_sethook(engine.global.address, null, 0, 0);
            } catch {
              // A budget exception may leave the Lua stack unusable, but closing
              // the state remains safe. Hook cleanup is therefore best effort.
            }
          }
          engine.global.close();
          for (const pointer of functionPointers) {
            engine.global.lua.module.removeFunction(pointer);
          }
        }
        activeEngine = undefined;
        running = false;
      }
    },

    close(): void {
      if (closed) return;
      closed = true;
      activeEngine?.global.close();
      activeEngine = undefined;
    },
  };
}

function runLockdown(global: LuaGlobalLike): number {
  const { lua: api, address: state } = global;
  global.loadString(LOCKDOWN, "=digipology-lockdown");
  const status = api.lua_pcallk(state, 0, 1, 0, 0, null);
  if (status !== LUA_OK) {
    throw new Error(`Sandbox lockdown failed: ${luaErrorMessage(api, state)}`);
  }
  return api.luaL_ref(state, LUA_REGISTRYINDEX);
}

function createNullSentinel(api: LuaApi, state: number): number {
  api.lua_newuserdatauv(state, 1, 0);
  api.lua_createtable(state, 0, 1);
  pushString(api, state, "__metatable");
  pushString(api, state, "locked");
  api.lua_rawset(state, -3);
  api.lua_setmetatable(state, -2);
  return api.luaL_ref(state, LUA_REGISTRYINDEX);
}

function injectEnvironment(
  context: RunContext,
  environmentIndex: number,
  values: ReadonlyMap<string, unknown>,
): void {
  for (const [key, value] of values) {
    if (key === "_G") {
      throw new TypeError("env._G is reserved by the sandbox");
    }
    pushString(context.api, context.state, key);
    pushHostValue(context, value, new Set<object>());
    context.api.lua_rawset(context.state, environmentIndex);
  }
}

function pushHostValue(
  context: RunContext,
  value: unknown,
  active: Set<object>,
): void {
  const { api, state } = context;
  if (value === null) {
    api.lua_rawgeti(state, LUA_REGISTRYINDEX, BigInt(context.nullReference));
    return;
  }

  switch (typeof value) {
    case "boolean":
      api.lua_pushboolean(state, value ? 1 : 0);
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Host values must contain only finite numbers");
      }
      if (Number.isSafeInteger(value)) api.lua_pushinteger(state, BigInt(value));
      else api.lua_pushnumber(state, value);
      return;
    case "string":
      pushString(api, state, value);
      return;
    case "function":
      pushHostFunction(context, value);
      return;
    case "object":
      break;
    default:
      throw new TypeError(`Unsupported host value type: ${typeof value}`);
  }

  if (active.has(value)) throw new TypeError("Host values must not contain cycles");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      api.lua_createtable(state, value.length, 0);
      const tableIndex = api.lua_absindex(state, -1);
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TypeError("Host arrays must not be sparse");
        }
        pushHostValue(context, value[index], active);
        api.lua_rawseti(state, tableIndex, BigInt(index + 1));
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Host objects must have a plain or null prototype");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("Host objects must not have symbol keys");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    api.lua_createtable(state, 0, keys.length);
    const tableIndex = api.lua_absindex(state, -1);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError("Host objects must not contain accessors");
      }
      pushString(api, state, key);
      pushHostValue(context, descriptor.value, active);
      api.lua_rawset(state, tableIndex);
    }
  } finally {
    active.delete(value);
  }
}

function pushHostFunction(context: RunContext, fn: Function): void {
  const pointer = context.api.module.addFunction((calledState) => {
    const callbackContext: RunContext = { ...context, state: calledState };
    try {
      const argumentCount = context.api.lua_gettop(calledState);
      const arguments_: LuaValue[] = [];
      for (let index = 1; index <= argumentCount; index += 1) {
        arguments_.push(extractValue(callbackContext, index, new Set<number>()));
      }
      const result = fn(...arguments_);
      if (isPromiseLike(result)) {
        throw new TypeError("Host functions must return synchronously");
      }
      pushHostValue(callbackContext, result, new Set<object>());
      return 1;
    } catch (cause) {
      pushString(context.api, calledState, errorMessage(cause));
      return context.api.lua_error(calledState);
    }
  }, "ii");
  context.functionPointers.push(pointer);
  context.api.lua_pushcclosure(context.state, pointer, 0);
}

function extractValue(
  context: RunContext,
  index: number,
  activeTables: Set<number>,
): LuaValue {
  const { api, state } = context;
  const absoluteIndex = api.lua_absindex(state, index);
  const type = api.lua_type(state, absoluteIndex);

  switch (type) {
    case LUA_TNIL:
      return null;
    case LUA_TBOOLEAN:
      return api.lua_toboolean(state, absoluteIndex) !== 0;
    case LUA_TNUMBER: {
      if (api.lua_isinteger(state, absoluteIndex)) {
        const integer = api.lua_tointegerx(state, absoluteIndex, null);
        const number = Number(integer);
        if (!Number.isSafeInteger(number)) {
          throw extractionError("Lua integer is outside JavaScript's safe range");
        }
        return number;
      }
      const number = api.lua_tonumberx(state, absoluteIndex, null);
      if (!Number.isFinite(number)) {
        throw extractionError("Lua returned a nonfinite number");
      }
      return number;
    }
    case LUA_TSTRING:
      return readString(api, state, absoluteIndex);
    case LUA_TTABLE:
      return extractTable(context, absoluteIndex, activeTables);
    case LUA_TUSERDATA:
      if (api.lua_topointer(state, absoluteIndex) === context.nullPointer) return null;
      throw extractionError("Lua userdata cannot be extracted");
    case LUA_TFUNCTION:
      throw extractionError("Lua functions cannot be extracted");
    case LUA_TTHREAD:
      throw extractionError("Lua threads cannot be extracted");
    default:
      throw extractionError("Unsupported Lua value cannot be extracted");
  }
}

function extractTable(
  context: RunContext,
  tableIndex: number,
  activeTables: Set<number>,
): LuaValue {
  const { api, state } = context;
  const pointer = api.lua_topointer(state, tableIndex);
  if (activeTables.has(pointer)) throw extractionError("Lua table contains a cycle");
  activeTables.add(pointer);

  const numeric = new Map<number, LuaValue>();
  const stringEntries: Array<[string, LuaValue]> = [];
  let hasNumeric = false;
  let hasString = false;

  try {
    api.lua_pushnil(state);
    while (api.lua_next(state, tableIndex) !== 0) {
      try {
        const keyType = api.lua_type(state, -2);
        const value = extractValue(context, -1, activeTables);
        if (keyType === LUA_TNUMBER && api.lua_isinteger(state, -2)) {
          const integer = api.lua_tointegerx(state, -2, null);
          const key = Number(integer);
          if (!Number.isSafeInteger(key) || key < 1) {
            throw extractionError("Array keys must be positive safe integers");
          }
          hasNumeric = true;
          numeric.set(key, value);
        } else if (keyType === LUA_TSTRING) {
          hasString = true;
          stringEntries.push([readString(api, state, -2), value]);
        } else {
          throw extractionError("Table keys must be strings or positive integers");
        }
      } finally {
        pop(api, state);
      }
    }
  } finally {
    activeTables.delete(pointer);
  }

  if (hasNumeric && hasString) {
    throw extractionError("Tables with mixed integer and string keys cannot be extracted");
  }
  if (hasNumeric) {
    const result: LuaValue[] = [];
    for (let key = 1; key <= numeric.size; key += 1) {
      const value = numeric.get(key);
      if (value === undefined) {
        throw extractionError("Sparse Lua arrays cannot be extracted");
      }
      result.push(value);
    }
    return result;
  }

  const result: { [key: string]: LuaValue } = Object.create(null) as {
    [key: string]: LuaValue;
  };
  for (const [key, value] of stringEntries) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return result;
}

function snapshotEnvironment(
  environment: Record<string, unknown> | undefined,
  label: string,
): ReadonlyMap<string, unknown> {
  if (environment === undefined) return new Map();
  if (environment === null || typeof environment !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  if (Object.getOwnPropertySymbols(environment).length !== 0) {
    throw new TypeError(`${label} must not have symbol keys`);
  }
  const result = new Map<string, unknown>();
  const descriptors = Object.getOwnPropertyDescriptors(environment);
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`${label} must not contain accessors`);
    }
    result.set(key, descriptor.value);
  }
  return result;
}

function normalizeError(kind: LuaErrorKind, cause: unknown): LuaError {
  const message = errorMessage(cause);
  if (isMemoryMessage(message)) return makeLuaError("memory_exceeded", message, cause);
  return makeLuaError(kind, message, cause);
}

function makeLuaError(
  kind: LuaErrorKind,
  message: string,
  cause?: unknown,
): LuaError {
  const line = parseLine(message);
  return new LuaError(kind, message, {
    ...(line === undefined ? {} : { line }),
    script: CHUNK_NAME,
    ...(cause === undefined ? {} : { cause }),
  });
}

function extractionError(message: string): LuaError {
  return new LuaError("extraction", message, { script: CHUNK_NAME });
}

function luaErrorMessage(api: LuaApi, state: number): string {
  const type = api.lua_type(state, -1);
  return type === LUA_TSTRING
    ? readString(api, state, -1)
    : "Lua raised a non-string error value";
}

function parseLine(message: string): number | undefined {
  const match = /(?:\[string ["']sandbox["']\]|sandbox):(\d+):/.exec(message);
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function isMemoryMessage(message: string): boolean {
  // Wasmoon throws these strings on paths where it does not expose a Lua
  // status code. Keep this list exact so user-authored error text is runtime.
  return message === LUA_MEMORY_ERROR
    || message === "lua_newstate returned a null pointer"
    || message === "Global state could not be created (probably due to lack of memory)";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function pop(api: LuaApi, state: number, count = 1): void {
  api.lua_settop(state, -count - 1);
}

function setGlobal(api: LuaApi, state: number, name: string): void {
  // lua_setglobal is a macro over lua_setfield in the C API. Wasmoon exposes
  // it, but keeping this compatibility helper off the public adapter avoids
  // any Wasmoon type in our declarations.
  (api as LuaApi & { lua_setglobal(state: number, name: string): void }).lua_setglobal(
    state,
    name,
  );
}

function pushString(api: LuaApi, state: number, value: string): void {
  const bytes = encodeUtf8(value);
  const pointer = api.module._malloc(Math.max(1, bytes.length));
  if (pointer === 0) throw new MemoryAbort("Unable to allocate a UTF-8 buffer");
  try {
    api.module.HEAPU8.set(bytes, pointer);
    api.module._lua_pushlstring(state, pointer, bytes.length);
  } finally {
    api.module._free(pointer);
  }
}

function readString(api: LuaApi, state: number, index: number): string {
  const lengthPointer = api.module._malloc(4);
  if (lengthPointer === 0) throw new MemoryAbort("Unable to read a Lua string");
  try {
    const pointer = api.module._lua_tolstring(state, index, lengthPointer);
    const length = api.module.getValue(lengthPointer, "i32") >>> 0;
    return decodeUtf8(api.module.HEAPU8.subarray(pointer, pointer + length));
  } finally {
    api.module._free(lengthPointer);
  }
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index] ?? 0;
    let codePoint: number;
    let width: number;
    if (first < 0x80) {
      codePoint = first;
      width = 1;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      width = 2;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      width = 3;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      width = 4;
    } else {
      result += "\ufffd";
      index += 1;
      continue;
    }
    if (index + width > bytes.length) {
      result += "\ufffd";
      break;
    }
    let valid = true;
    for (let offset = 1; offset < width; offset += 1) {
      const next = bytes[index + offset] ?? 0;
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    const minimum = width === 2 ? 0x80 : width === 3 ? 0x800 : width === 4 ? 0x10000 : 0;
    if (
      !valid ||
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      result += "\ufffd";
      index += 1;
      continue;
    }
    result += String.fromCodePoint(codePoint);
    index += width;
  }
  return result;
}
