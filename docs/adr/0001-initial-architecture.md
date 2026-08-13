# ADR-0001: Initial architecture

Status: Accepted · Date: 2026-08-13

## Context

Digipology starts from the "Web Tabletop Platform — Firm Handoff v2" document (`docs/spec/handoff-v2.txt`), treated as directional input. The project owner delegated design/architecture decisions to the engineering manager (this repo's orchestrator).

## Decisions

1. **Adopt the deterministic-kernel thesis** from the spec as the core architecture: canonical gameplay = initial snapshot + ordered actions run through a pure, versioned kernel; renderer and network are non-authoritative. This is the strongest idea in the handoff and everything else hangs off it.
2. **Language/tooling**: TypeScript (strict) everywhere; Bun as package manager/test runner/monorepo tool; GitHub Actions CI on Linux.
3. **Package strategy**: small publishable units under unscoped npm names `digipology-*` (npm account `sanokei`; the `@digipology` org scope can be adopted later without breaking consumers — packages are 0.x). Kernel-side packages have zero runtime dependencies.
4. **Cloudflare stack**: Workers + Durable Objects (room sequencing), D1 (metadata), R2 (assets/releases), static assets on Workers for digipology.com. One logical Room DO per active table.
5. **Wire protocol v1 is JSON** with explicit `protocolVersion`; canonical serialization is a dedicated `digipology-canonical-json` package (sorted keys, UTF-8, finite-number policy, SHA-256 hashing) shared by kernel and services.
6. **PRNG**: versioned algorithm behind an interface in `digipology-prng`; v1 algorithm chosen in its implementation issue (candidate: xoshiro256** or sfc32 with splitmix64 seeding — must be exactly reproducible in pure TS across engines, using BigInt or 32-bit integer math only).
7. **Lua**: Wasmoon as the baseline Lua host in `digipology-lua`, wrapped so the kernel-facing API is implementation-agnostic (swap-out path if Wasmoon can't be budgeted reliably).
8. **License**: MIT for the whole monorepo.
9. **Site first, app second**: digipology.com serves a landing + docs site immediately; the React+Babylon app ships under the same domain when playable.

## Consequences

- Determinism rules are enforceable per-package (lint/CI on kernel-side packages).
- npm publishing can start as soon as canonical-json/prng are review-clean, giving the ecosystem public artifacts early.
- Any change to a LOCKED spec decision requires a new ADR.
