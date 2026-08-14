# Agent instructions — Digipology

You are working in the Digipology monorepo: a browser-native tabletop platform (deterministic game kernel + Lua creator scripting + React/Babylon frontend + Cloudflare Workers backend). The authoritative spec is in `docs/spec/handoff-v2.txt`; decisions in `docs/adr/`.

## Hard architecture rules (violating these fails review)

1. **Kernel determinism**: code in `packages/kernel`, `packages/canonical-json`, `packages/prng` must be pure and deterministic. Forbidden there: `Math.random`, `Date.now`, `new Date()`, DOM/browser APIs, Node/Bun-specific APIs, Babylon, React, network, timers, `JSON.stringify` for canonical serialization (key order!), and any dependence on object-key iteration order for canonical results.
2. **Rendering separation**: Babylon.js is presentation only. Nothing canonical may live in or depend on the renderer.
3. **Canonical state is JSON-like**: finite numbers, strings, booleans, null, arrays, string-keyed objects. Reject NaN/Infinity/functions/cycles.
4. **Atomic actions**: a top-level action either fully applies or leaves gameplay state untouched. Rejected actions still consume a sequence number.
5. **Lua is hostile input**: the sandbox exposes only the documented API. No JS interop escape, no network, no filesystem.
6. **The Room DO sequences; clients simulate.** Never put game-rule logic in the worker.

## Conventions

- TypeScript strict mode; extend the root `tsconfig.base.json`.
- Runtime deps in kernel-side packages: zero. Dev deps: fine.
- Tests: `bun test` colocated as `*.test.ts` next to sources. New behavior needs tests; determinism-sensitive code needs fixture/golden tests.
- Package names: `digipology-<name>`, version `0.x` until stabilized, `"type": "module"`, exports map, `LICENSE` + `README.md` per package.
- Commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`). Reference issues (`#N`) in the PR body, not every commit.
- Do not add dependencies without need; prefer zero-dep implementations for core logic.
- If a PR changes dependencies, run `bun install` and commit the updated `bun.lock` in the same PR. On a `bun.lock` merge conflict, never hand-merge or accept either side: take the incoming `package.json` state, run `bun install`, commit the regenerated lockfile.
- Do not touch unrelated packages in a PR. Keep PRs scoped to one issue.

## Commands

```bash
bun install          # install workspace deps
bun test             # run all tests
bun run typecheck    # tsc --noEmit across workspaces
```

## Workflow

- Branch names: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<slug>`.
- PR title: conventional-commit style summary. PR body: what/why, linked issue (`Closes #N`), test evidence.
- CI must pass (`.github/workflows/ci.yml`): install, typecheck, test.
