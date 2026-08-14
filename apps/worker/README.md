# digipology-worker

The `digipology-play` Cloudflare Worker is the single-origin platform service
for the `apps/web` SPA, HTTP API v1, and Room Durable Object WebSocket endpoint.
The Room DO only authenticates room-scoped tokens and sequences protocol
actions; clients remain responsible for game simulation.

Room gameplay starts on the first authenticated WebSocket `hello`. At that
point the DO builds and persists a sequence-0 snapshot from the release and all
players that have joined so far, assigns `seat_1..seat_N` in HTTP join order,
and sequences `system.game_start` exactly once as action 1. A full bootstrap
sends the room snapshot before the retained ordered stream, so clients apply
`game_start` themselves. Players admitted after start are represented by
`system.player_joined` and `system.seat_assign`; WebSocket loss alone remains a
transport condition and does not produce a canonical departure.

## Platform storage and routing

`wrangler.jsonc` binds the `digipology` D1 database as `DB`, Email Service as
`EMAIL`, the Room DO namespace as `ROOM`, and prepares static assets from
`../web/dist`. D1 migrations live in `migrations/` and create users, sessions,
magic links, OAuth-ready identity rows, game/release metadata, the public-room
index, and fixed-window rate-limit counters.

Room IDs come from `ROOM.newUniqueId()`. D1 owns the normalized join-code to
room-ID mapping; after lookup, every join is validated by the mapped Room DO.
The room index is only a discovery cache for public listings and membership is
never inferred from it. Join codes contain eight symbols from a 32-character
unambiguous alphabet (`2^40` possibilities) and render as `XXXX-XXXX`.

The request-link limiter uses atomic D1 counters in fixed 15-minute windows
(three attempts per email and ten per IP). Join lookup uses a fixed one-minute
window (30 attempts per IP). Email and IP material is SHA-256 hashed before it
becomes a limiter key.

## Auth and Email Service

Configure the session HMAC secret without committing it:

```sh
cd apps/worker
bunx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` must contain at least 32 characters. Magic-link tokens and
room tokens are 32 random bytes. D1 and DO storage contain only token hashes;
session hashes are additionally keyed with `SESSION_SECRET`. Session cookies
are `HttpOnly`, `Secure`, `SameSite=Lax`, and roll for 30 days on use.

Before production email can send, the operator must onboard the sender domain:

```sh
bunx wrangler email sending enable digipology.com
```

Email Service failures are logged as structured error codes without addresses,
links, or token content, while the request-link endpoint still returns 204.

For local-only magic-link delivery, create an uncommitted `.dev.vars`:

```dotenv
SESSION_SECRET=replace-with-at-least-32-local-characters
EMAIL_DEV_MODE=true
PUBLIC_ORIGIN=http://127.0.0.1:8787
```

`EMAIL_DEV_MODE` is deliberately absent from committed production config. When
enabled, the worker prints only the retrieval path (never the token) and stores
an AES-GCM-encrypted development token. Retrieve the latest link from
`GET /api/dev/last-magic-link`; without that guard variable the route is 404.

## Local development

AI game creation is intentionally keyless-safe. Production operators enable it
with the interactive secret command (the key must never be added to
`wrangler.jsonc`):

```sh
bunx wrangler secret put DEEPSEEK_API_KEY
```

`DEEPSEEK_MODEL` and `AI_DAILY_USD_CAP` are non-secret vars. Their committed
defaults are `deepseek-v4-flash` and USD 1 per user per UTC day. Without the
secret, authenticated AI draft endpoints return `503 ai_unconfigured`; manual
uploads and publishing remain available.

From the repository root:

```sh
bun install
cd apps/worker
bunx wrangler d1 migrations apply digipology --local
bun run dev
```

The API listens on Wrangler's displayed local URL (normally
`http://127.0.0.1:8787`). All non-GET API calls must include
`X-Digipology-CSRF: 1` (the header the `apps/web` client sends). In another
terminal, run:

```sh
cd apps/worker
bun run smoke
```

The smoke script lists the catalog, creates a release-pinned private room,
joins through the D1 code mapping, completes two WebSocket hellos, verifies
sequencing/dedup/resume, and confirms the room capacity error.

## Verification

```sh
bun test apps/worker
bun run --cwd apps/worker typecheck
bunx wrangler d1 migrations apply digipology --local
```

The built-in catalog implements `GameCatalog` in `src/catalog.ts` and is backed
by the immutable `digipology-demo-games` workspace catalog.
