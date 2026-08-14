# ADR-0002: Play platform — subdomains, auth, rooms, API v1

Status: Accepted · Date: 2026-08-13

## Context

Project owner direction: "auth and a login and https://play.digipology.com/ to be able to play uploaded games, you can join a room or make your own and make it public or private and share." Wave 2 delivers the deterministic kernel, the Room DO sequencing skeleton, and the sandboxed Lua host. This ADR pins the platform decisions the next waves build on.

## Decisions

### 1. Subdomain topology
- `digipology.com` — static site + docs (existing worker `digipology-site`).
- `play.digipology.com` — **one** Worker (`digipology-play`) serving the built `apps/web` SPA as static assets, the `/api/*` HTTP API, and the Room Durable Object WebSocket path. Single origin ⇒ no CORS, one deploy unit, cookies stay first-party.

### 2. Auth: passwordless magic-link email (MVP)
- Rationale: third-party OAuth apps (GitHub/Discord) require manual dashboard creation by the owner; magic links are fully automatable on the Cloudflare account (Email Service + zone DNS for SPF/DKIM). Passwords are rejected outright (no credential storage burden).
- Flow: `POST /api/auth/request-link {email}` → single-use token (32B random, SHA-256 hash stored, 15 min TTL) → email link `https://play.digipology.com/api/auth/verify?token=…` → session created, HttpOnly+Secure+SameSite=Lax cookie `dgp_session`, 30-day rolling expiry, opaque token hashed in D1.
- Email delivery behind an `EmailSender` interface: production = Cloudflare Email Service; dev/fallback = log + `wrangler dev`-only retrieval endpoint. If Email Service turns out unavailable on the account, auth still ships and the operator is alerted.
- Internal `userId` is the only identity that crosses domain objects (PRD-ID-004). `oauth_identities` table exists from day one so Discord/GitHub OAuth can be added without migration pain.
- Guests: joining an invite-only room never requires an account (PRINCIPLE-002) — display name only. Auth-gated: creating **public** rooms, uploading/publishing games, library, persistent saves (PRD-ID-003).

### 3. Data
- D1 database `digipology`: `users`, `sessions`, `magic_links`, `oauth_identities`, `games`, `releases`, `rooms_index`. Migrations live in `apps/worker/migrations/` and are applied by the deploy pipeline (SPEC 07.10).
- Built-in demo games ship as `packages/demo-games` (typed catalog of release manifests + Lua sources, imported by the worker); uploaded games (R2 bucket `digipology-releases`, validation pipeline) are the next wave.
- The Room DO remains the sequencer only. Room *metadata* (join code, visibility, release id, player count snapshot) is indexed in D1 for discovery; the DO stays authoritative for membership (SPEC 05.10 — index is a discovery cache).

### 4. Rooms
- Create: `visibility: "private" | "public"`. Private creatable by guests and users; public requires auth. Room pins a `releaseId` at creation.
- Share: invite URL `https://play.digipology.com/join/<CODE>`; code format `XXXX-XXXX` from a 32-char unambiguous alphabet (~40 bits, rate-limited lookups — SPEC 07.7).
- Public rooms listed at `GET /api/rooms/public` from the D1 index.

### 5. API v1 (contract — implementations and the web app must match this)
```
POST  /api/auth/request-link   {email}                        → 204 (always; rate-limited)
GET   /api/auth/verify?token=… → Set-Cookie + 302 /
POST  /api/auth/logout                                        → 204
GET   /api/me                  → {user: {id,name,email} | null}
PATCH /api/me                  {name}                         → {user}
GET   /api/games               → {games: [{slug,title,tagline,minPlayers,maxPlayers,builtin}]}
GET   /api/games/:slug         → {game, latestRelease: {releaseId, kernelVersion, luaApiVersion}}
POST  /api/rooms               {releaseSlugOrId, visibility, displayName?} → {roomId, joinCode, inviteUrl, playerId, roomToken, wsUrl}
POST  /api/rooms/join          {code, displayName?}           → {roomId, playerId, roomToken, wsUrl, releaseId} | structured error (not_found | full | ended)
GET   /api/rooms/public        → {rooms: [{joinCode, gameTitle, players, maxPlayers, createdAt}]}
GET   /api/releases/:id/bundle → release JSON bundle (immutable, cacheable)
WS    /api/rooms/:roomId/ws    (roomToken; speaks digipology-protocol v1)
```
Errors: JSON `{error: {code, message}}`, stable `code` strings. All non-GET routes CSRF-safe by same-origin + SameSite cookie + custom header check.

## Consequences
- No OAuth until the owner creates provider apps (documented, schema-ready).
- One worker per environment keeps ops simple; splitting API from assets later is a routing change, not an architecture change.
- Demo games double as end-to-end determinism fixtures — the play slice is also the integration test of kernel + lua + protocol + DO.
