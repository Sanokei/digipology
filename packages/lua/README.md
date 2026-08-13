# digipology-lua

`digipology-lua` is the hostile-input Lua 5.4 host for Digipology. It runs
Wasmoon behind a small implementation-neutral API, installs a fresh locked
environment for every `run()`, applies an instruction budget, and copies values
across a strict JSON-like bridge. No Wasmoon type appears in the public type
declarations.

```ts
import { createSandbox } from "digipology-lua";

const sandbox = await createSandbox({
  instructionBudget: 50_000,
  memoryBudgetBytes: 256 * 1024,
  env: { score: 10 },
});

try {
  const result = await sandbox.run("return score + bonus", { bonus: 2 });
  // result === 12
} finally {
  sandbox.close();
}
```

`close()` is idempotent. Calls to `run()` are serialized by the caller;
concurrent calls reject. A closed sandbox rejects subsequent runs. Each run
uses a fresh VM, so Lua globals do not persist between calls. Gameplay state
that must persist belongs in the kernel-managed `env` value and must be passed
back explicitly.

## Sandbox surface

The host opens Lua's standard libraries only for a privileged lockdown chunk.
User chunks receive a newly built `_G` containing this surface:

| Available | Behavior |
| --- | --- |
| `_VERSION`, `assert`, `error`, `getmetatable`, `ipairs`, `next`, `pairs`, `rawequal`, `rawget`, `rawlen`, `rawset`, `select`, `setmetatable`, `tonumber`, `type` | Standard Lua behavior |
| `string`, `table`, `utf8` | Fresh shallow copies of the standard library tables |
| `math` | Standard math functions except `random` and `randomseed` |
| `os.time`, `os.clock` | Deterministic stubs that always return `0` |
| `tostring` | Standard for scalar values; returns stable type markers for tables, functions, userdata, and threads instead of addresses |
| `collectgarbage` | Only `collectgarbage("count")` is accepted; mutation/control modes reject |
| `pcall`, `xpcall` | Standard results, except memory-budget failures are promoted to an uncatchable host abort |
| caller `env` keys | Strictly copied values and explicitly whitelisted synchronous functions |

The following are absent: `io`, `require`, `dofile`, `loadfile`, `package`,
`debug`, `load`, `loadstring`, `coroutine`, `print`, `warn`, and any Wasmoon
JS-object, proxy, Promise, Error, or `js` bridge. Browser globals such as
`window`, `document`, `fetch`, `WebSocket`, and `XMLHttpRequest` are not copied
into Lua. Wasmoon is created with both object injection and proxy support off.
Only values supplied in `env` create a host capability.

Dynamic loading is removed rather than wrapped. This makes source and bytecode
loading equally unavailable and avoids an alternate environment-installation
path; consequently a bytecode string beginning with `0x1b` cannot be loaded.

Coroutines are removed in v1. A hook installed only on the main Lua state does
not automatically and reliably cover every newly created coroutine in the
Wasmoon wrapper. Removing the library makes the instruction-boundary claim
simple and auditable. Coroutines can be reconsidered only with per-thread hook
installation and adversarial budget tests.

The privileged chunk also replaces and locks the string metatable before the
old global table becomes unreachable. `getmetatable("")` therefore returns the
marker `"locked"`, not a table that can lead back to stripped globals.

The built-in runtime never reads real time. A caller can deliberately expose a
time-returning function through `env`, just as it can expose any other explicit
capability; deterministic callers must provide deterministic functions and
values.

## Instruction budgeting

The investigation order from ADR-0001 produced these findings:

1. Wasmoon 1.16.0 does not offer instruction budgets in its supported engine
   API. Its public timeout is wall-clock based and was not used.
2. Its exported underlying Lua C bindings do expose `lua_sethook`, and its
   Emscripten module exposes callable function-table entries. These bindings are
   usable in Bun and browsers, so the package installs a count hook directly.
3. The privileged `debug.sethook` fallback is therefore unnecessary. `debug`
   is removed before user code starts.

The count hook runs every `min(instructionBudget, 100)` Lua VM instructions and
throws a private host signal once the per-call budget is reached. Throwing
across the WASM boundary is intentional: raising a normal Lua error from a hook
can be swallowed indefinitely by `pcall`. The private signal bypasses Lua error
handlers, so budget exhaustion is non-catchable. The affected VM is discarded
and remains safely closeable. Accounting starts at zero for every `run()`.

The budget counts Lua VM instructions, not time, Wasmoon bridge work, or work
performed inside an explicitly supplied host function. Host functions are a
trusted capability and must bound their own work. C library operations can do
substantial work in a single Lua instruction; the memory allocator limit is the
separate guardrail for allocation-heavy library calls such as `string.rep`.

This implementation depends only on Wasmoon's internal C-binding availability,
not its types or engine API in the public surface. If a future Wasmoon release
removes usable `lua_sethook` access, that release must not replace this with a
wall-clock-only timeout; pin Wasmoon or swap the implementation.

## Memory semantics

When `memoryBudgetBytes` is supplied, Wasmoon's tracing allocator is enabled.
After the standard libraries, lockdown environment, and null sentinel have
been created, the option is added as per-run allocation headroom and installed
as the allocator's hard maximum. An allocation that would cross the ceiling is
refused by the Lua allocator and becomes `LuaError` with kind
`"memory_exceeded"`. The `pcall`/`xpcall` wrappers recognize Lua allocator
errors and promote them to the same non-catchable host signal.

This cap is precise for live allocations made through that Lua state's custom
allocator. It does not include the fixed VM baseline, the WebAssembly module's
code and linear-memory capacity, temporary JS/WASM bridge buffers, caller host
functions, or the JavaScript object produced during extraction. Freed Lua
allocations reduce the live count. `collectgarbage("count")` exposes Lua's
kilobyte observation, but it is not the enforcement mechanism. WebAssembly
linear memory may retain already-grown pages even after Lua frees objects; the
allocator's live-byte count and WASM process memory therefore are not the same
measurement.

Without `memoryBudgetBytes`, no allocator ceiling is installed. The instruction
budget still bounds Lua loops, but callers handling untrusted scripts should
configure both budgets because one C library call can allocate heavily before
another instruction-hook checkpoint.

## Value bridge

Host-to-Lua values accept `null`, booleans, finite numbers, strings, dense
arrays, plain or null-prototype string-keyed objects, and explicitly supplied
synchronous functions. Object keys are inserted in sorted order. Inherited
properties, including prototype-pollution payloads, are ignored; accessors,
symbols, sparse arrays, unsupported prototypes, cycles, `undefined`, and
nonfinite numbers reject before user code runs. Per-run `env` keys override
creation-time keys. `_G` is reserved.

`null` nested in a table uses a private, metatable-locked userdata sentinel so
it can round-trip without Lua's `nil` deleting the entry. No other userdata is
extractable. Host functions receive arguments after the same strict extraction
and must return synchronously in the same value domain. A host function is the
only intentional JS callable reachable from its corresponding `env` entry.

Lua-to-host extraction follows these rules:

- `nil` becomes `null`; booleans and strings are copied.
- Numbers must be finite. Lua integers must fit JavaScript's safe-integer range.
- A table whose keys are exactly the contiguous integers `1..n` becomes an
  array. Lua normalizes an integral float key such as `1.0` to an integer key.
- A table with only string keys becomes a null-prototype object. An empty table
  is an object.
- Sparse integer tables, fractional/nonsafe/nonpositive numeric keys, mixed
  string/integer keys, unsupported key types, cycles, functions, threads, and
  non-sentinel userdata reject with `LuaError { kind: "extraction" }`.
- Shared acyclic tables are copied by value and do not preserve identity.

Lua's native `tostring(table)` normally contains an address. The sandbox
replaces it with stable markers so address-dependent strings cannot cross the
bridge. Table traversal order is not exposed as an array ordering unless the
keys are exactly `1..n`.

## Errors

All script failures are `LuaError` instances. `kind` distinguishes `syntax`,
`runtime`, `budget_exceeded`, `memory_exceeded`, and `extraction`. Syntax and
ordinary runtime messages are parsed for their Lua source line; when available,
`line` is set and `script` is `"sandbox"`. A direct budget or allocator abort
may not have a meaningful source line and therefore leaves `line` undefined.

## Browser use

The package itself uses no DOM, Node, Bun, filesystem, network, storage, or
timer API. Wasmoon supplies its WebAssembly VM and selects its documented
browser loader when running in a browser. Applications should bundle/copy the
Wasmoon WASM asset according to their bundler's Wasmoon configuration and CSP.

## Development

```sh
bun install
bun test packages/lua
bun run --cwd packages/lua typecheck
bun run --cwd packages/lua build
```
