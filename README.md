# Digipology

**Browser-native tabletop platform.** Create tabletop games visually and with Lua, playtest locally, publish immutable releases, and play multiplayer directly in the browser — no installs.

> CREATE → PLAYTEST → PUBLISH → BROWSE → HOST → INVITE → PLAY

🌐 [digipology.com](https://digipology.com)

## Architecture

Digipology is built around a **deterministic game kernel**: canonical gameplay is reconstructable as `initial snapshot + ordered actions`, and every healthy client converges to an identical state hash.

- **Kernel** — pure TypeScript deterministic simulation. No DOM, no renderer, no wall clock, no `Math.random`.
- **Rendering** — Babylon.js is presentation only, never canonical authority.
- **Scripting** — creator games are scripted in sandboxed Lua (Wasmoon), with instruction budgets and no browser/network escape.
- **Editor** — the desktop browser editor under `/edit` combines entity and component tools, a Lua IDE, undo history, local drafts, and in-tab playtesting.
- **AI creation** — prompt-created drafts and reviewed edits use a server-configured model; the browser never needs a provider API key.
- **Covers** — constrained cover specifications render through Digipology's deterministic cover system, with model-assisted directions when configured.
- **Multiplayer** — a Cloudflare Durable Object per room sequences actions over WebSocket; clients simulate. The room never runs game rules.
- **Publishing** — projects build into immutable releases; rooms and saves pin the exact release.

## Monorepo layout

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/canonical-json` | `digipology-canonical-json` | Canonical JSON serialization + SHA-256 state hashing |
| `packages/prng` | `digipology-prng` | Versioned deterministic PRNG |
| `packages/kernel` | `digipology-kernel` | Deterministic game kernel: state, actions, transactions |
| `packages/protocol` | `digipology-protocol` | Wire protocol schemas and types |
| `packages/lua` | `digipology-lua` | Sandboxed Lua runtime host (Wasmoon) |
| `packages/ai` | `digipology-ai` | Zero-dependency DeepSeek transport and structured-output harness for Digipology |
| `packages/covers` | `digipology-covers` | Deterministic, safe-by-construction CoverSpec rendering for Digipology |
| `packages/demo-games` | `digipology-demo-games` | Immutable built-in demo game release bundles for Digipology |
| `apps/worker` | — | Cloudflare Worker: platform API + Room Durable Object |
| `apps/web` | — | React + Babylon.js player and creator app |
| `apps/site` | — | digipology.com landing + docs |

## Development

Requires [Bun](https://bun.sh) ≥ 1.2.

```bash
bun install
bun test
bun run typecheck
```

## Specification

The product/architecture specification lives in [docs/spec](docs/spec/). Architecture decisions are recorded as ADRs in [docs/adr](docs/adr/).

## License

[MIT](LICENSE)
