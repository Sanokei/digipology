import { afterEach, describe, expect, test } from "bun:test";
import { createSandbox, LuaError, type LuaValue, type Sandbox } from "./index";

const sandboxes: Sandbox[] = [];

async function sandbox(
  instructionBudget = 50_000,
  memoryBudgetBytes?: number,
  env?: Record<string, unknown>,
): Promise<Sandbox> {
  const value = await createSandbox({
    instructionBudget,
    ...(memoryBudgetBytes === undefined ? {} : { memoryBudgetBytes }),
    ...(env === undefined ? {} : { env }),
  });
  sandboxes.push(value);
  return value;
}

afterEach(() => {
  for (const value of sandboxes.splice(0)) value.close();
});

function expectKind(error: unknown, kind: LuaError["kind"]): void {
  expect(error).toBeInstanceOf(LuaError);
  expect((error as LuaError).kind).toBe(kind);
}

describe("value bridge", () => {
  test("extracts nested arrays, objects, null and unicode", async () => {
    const lua = await sandbox();
    const input: LuaValue = {
      nested: [{ deeper: [{ value: "héllo 🌙" }] }],
      nothing: null,
      number: 1.25,
    };
    expect(await lua.run("return input", { input })).toEqual(input);
  });

  test("calls only explicitly injected host functions", async () => {
    const lua = await sandbox();
    expect(await lua.run("return add(20, 22)", { add: (a: number, b: number) => a + b })).toBe(42);
  });

  test("rejects mixed, sparse, cyclic, function and nonfinite results", async () => {
    const lua = await sandbox();
    for (const code of [
      "return { [1] = true, named = true }",
      "return { [1] = true, [3] = true }",
      "local value = {}; value.self = value; return value",
      "return function() end",
      "return 0 / 0",
      "return math.huge",
      "return { [1.5] = true }",
    ]) {
      try {
        await lua.run(code);
        throw new Error(`Expected extraction failure for: ${code}`);
      } catch (error) {
        expectKind(error, "extraction");
      }
    }
  });

  test("extracts a 1e6-element array within budget", async () => {
    const lua = await sandbox(20_000_000);
    const result = (await lua.run(
      "local t = {}; for i = 1, 1000000 do t[i] = i end; return t",
    )) as number[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1_000_000);
    expect(result[0]).toBe(1);
    expect(result[499_999]).toBe(500_000);
    expect(result[999_999]).toBe(1_000_000);
  }, 30_000);

  test("treats 1.0 keys as Lua integer keys and empty tables as objects", async () => {
    const lua = await sandbox();
    expect(await lua.run("return { [1.0] = 'one' }")).toEqual(["one"]);
    expect(await lua.run("return {}")) .toEqual({});
  });

  test("does not traverse polluted prototypes or accessors", async () => {
    const lua = await sandbox();
    const polluted = Object.create({ fetch: () => "escaped" }) as Record<string, unknown>;
    Object.defineProperty(polluted, "safe", { value: 7, enumerable: true });
    expect(await lua.run("return { safe = safe, fetch = fetch }", polluted)).toEqual({ safe: 7 });

    const accessor = Object.defineProperty({}, "bad", {
      enumerable: true,
      get: () => 1,
    });
    await expect(createSandbox({ instructionBudget: 100, env: accessor })).rejects.toThrow();
  });
});

describe("sandbox hardening", () => {
  test("removes filesystem, module, debug, coroutine and browser capabilities", async () => {
    const lua = await sandbox();
    const result = await lua.run(`
      return {
        io = io, require = require, package = package, debug = debug,
        dofile = dofile, loadfile = loadfile, load = load,
        loadstring = loadstring, coroutine = coroutine,
        window = window, document = document, fetch = fetch,
        WebSocket = WebSocket, XMLHttpRequest = XMLHttpRequest
      }
    `);
    expect(result).toEqual({});
  });

  test("provides deterministic time and removes random", async () => {
    const lua = await sandbox();
    expect(await lua.run("return { os.time(), os.clock(), math.random, math.randomseed }"))
      .toEqual([0, 0]);
  });

  test("locks the string metatable and cannot recover original globals", async () => {
    const lua = await sandbox();
    expect(await lua.run(`
      local mt = getmetatable("")
      return {
        metatable = mt,
        debug = rawget(_G, "debug"),
        package = rawget(_G, "package"),
        js = rawget(_G, "js")
      }
    `)).toEqual({ metatable: "locked" });
  });

  test("a recursive global sweep finds no Wasmoon or browser bridge", async () => {
    const lua = await sandbox(200_000);
    expect(await lua.run(`
      local forbidden = {
        js = true, window = true, document = true, fetch = true,
        WebSocket = true, XMLHttpRequest = true, require = true,
        package = true, io = true, debug = true
      }
      local seen = {}
      local function sweep(value, depth)
        if type(value) ~= "table" or seen[value] or depth > 4 then return nil end
        seen[value] = true
        for key, child in pairs(value) do
          if forbidden[key] then return key end
          local found = sweep(child, depth + 1)
          if found then return found end
        end
        return nil
      end
      return sweep(_G, 0)
    `)).toBeNull();
  });

  test("rejects bytecode because dynamic loading is absent", async () => {
    const lua = await sandbox();
    try {
      await lua.run("return load('\\27Lua')");
      throw new Error("Expected bytecode load to fail");
    } catch (error) {
      expectKind(error, "runtime");
    }
  });

  test("restricts collectgarbage and masks address-bearing tostring values", async () => {
    const lua = await sandbox();
    expect(await lua.run("return { tostring({}), type(collectgarbage('count')) }"))
      .toEqual(["<table>", "number"]);
    await expect(lua.run("return collectgarbage('collect')")).rejects.toMatchObject({
      kind: "runtime",
    });
  });
});

describe("instruction budget", () => {
  test("interrupts an infinite loop and remains safely closeable", async () => {
    const lua = await sandbox(1_000);
    try {
      await lua.run("while true do end");
      throw new Error("Expected budget failure");
    } catch (error) {
      expectKind(error, "budget_exceeded");
    }
    lua.close();
    lua.close();
  });

  test("pcall cannot swallow the budget signal", async () => {
    const lua = await sandbox(2_000);
    await expect(lua.run(`
      while true do
        pcall(function() while true do end end)
      end
      return "unreachable"
    `)).rejects.toMatchObject({ kind: "budget_exceeded" });
  });

  test("bounds recursion and string concatenation", async () => {
    const lua = await sandbox(2_000);
    await expect(lua.run("local function f() return f() end; return f()"))
      .rejects.toBeInstanceOf(LuaError);
    await expect(lua.run("local s = ''; while true do s = s .. 'x' end"))
      .rejects.toMatchObject({ kind: "budget_exceeded" });
  });

  test("a script using about half its budget completes", async () => {
    // Calibrated: this loop costs ~2.2k VM instructions (it fails below a
    // 2_500 budget), so a 5_000 budget leaves roughly half unused.
    const lua = await sandbox(5_000);
    expect(await lua.run("local n = 0; for i = 1, 1000 do n = n + i end; return n"))
      .toBe(500_500);
  });

  test("resets accounting between runs", async () => {
    const lua = await sandbox(20_000);
    const code = "local n = 0; for i = 1, 1000 do n = n + i end; return n";
    expect(await lua.run(code)).toBe(500_500);
    expect(await lua.run(code)).toBe(500_500);
  });

  test("interrupts an infinite recursion hidden behind pcall", async () => {
    const lua = await sandbox(5_000);
    await expect(lua.run(`
      local function recurse() return recurse() end
      while true do pcall(recurse) end
    `)).rejects.toMatchObject({ kind: "budget_exceeded" });
  });
});

describe("memory budget", () => {
  test("does not classify user memory or allocation errors as allocator failures", async () => {
    const lua = await sandbox();
    for (const message of ["out of memory lol", "allocation failed by user"]) {
      await expect(lua.run(`error(${JSON.stringify(message)}, 0)`)).rejects.toMatchObject({
        kind: "runtime",
        message,
      });
    }
  });

  test("keeps user memory and allocation errors catchable by pcall and xpcall", async () => {
    const lua = await sandbox();
    expect(await lua.run(`
      local results = {}
      for index, message in ipairs({ "out of memory lol", "allocation failed by user" }) do
        local pcall_ok, pcall_error = pcall(function()
          error(message, 0)
        end)
        local xpcall_ok, xpcall_error = xpcall(function()
          error(message, 0)
        end, function(caught)
          return caught
        end)
        results[index] = {
          message = message,
          pcall_ok = pcall_ok,
          pcall_error = pcall_error,
          xpcall_ok = xpcall_ok,
          xpcall_error = xpcall_error,
        }
      end
      return results
    `)).toEqual([
      {
        message: "out of memory lol",
        pcall_ok: false,
        pcall_error: "out of memory lol",
        xpcall_ok: false,
        xpcall_error: "out of memory lol",
      },
      {
        message: "allocation failed by user",
        pcall_ok: false,
        pcall_error: "allocation failed by user",
        xpcall_ok: false,
        xpcall_error: "allocation failed by user",
      },
    ]);
  });

  test("controls a string.rep bomb", async () => {
    const lua = await sandbox(50_000, 64 * 1024);
    await expect(lua.run("return string.rep('x', 2^30)"))
      .rejects.toMatchObject({ kind: "memory_exceeded" });
  });

  test("controls table growth and memory errors inside pcall", async () => {
    const lua = await sandbox(2_000_000, 64 * 1024);
    await expect(lua.run("local t = {}; while true do t[#t + 1] = #t end"))
      .rejects.toMatchObject({ kind: "memory_exceeded" });
    await expect(lua.run(`
      while true do
        local ok = pcall(string.rep, "x", 2^30)
        if not ok then local marker = 1 end
      end
    `)).rejects.toMatchObject({ kind: "memory_exceeded" });
    await expect(lua.run(`
      while true do
        local ok = xpcall(function()
          return string.rep("x", 2^30)
        end, function(message)
          return message
        end)
        if not ok then local marker = 1 end
      end
    `)).rejects.toMatchObject({ kind: "memory_exceeded" });
  });
});

describe("diagnostics and determinism", () => {
  test("reports syntax and runtime lines", async () => {
    const lua = await sandbox();
    for (const [code, kind, line] of [
      ["local x = 1\nlocal = 2\nreturn x", "syntax", 2],
      ["local x = 1\nlocal y = 2\nerror('boom')", "runtime", 3],
    ] as const) {
      try {
        await lua.run(code);
        throw new Error("Expected Lua error");
      } catch (error) {
        expectKind(error, kind);
        expect((error as LuaError).line).toBe(line);
        expect((error as LuaError).script).toBe("sandbox");
      }
    }
  });

  test("fresh sandboxes produce identical values", async () => {
    const first = await sandbox();
    const second = await sandbox();
    const code = "return { time = os.time(), clock = os.clock(), value = tostring({}) }";
    expect(await first.run(code)).toEqual(await second.run(code));
  });
});
