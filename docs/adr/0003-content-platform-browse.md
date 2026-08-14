# ADR-0003: Content-platform browse & quick play

Status: Accepted · Date: 2026-08-14

## Context

Owner direction: the play home should feel like a content platform (YouTube/Roblox/Netflix). Game capsules show cover image, title, **current player count**, and **total ever plays**. Hovering a capsule for **350 ms** reveals quick actions — **Quick Play** and **Host a Room**. Clicking the thumbnail or title triggers Quick Play directly.

## Decisions

### 1. Capsule & interaction contract
- Home (`/`) of play.digipology.com is the capsule grid (browse-first). Capsule: 16:9 cover, title, live-count badge (green dot + n playing), total plays (compact form, e.g. `1.2k plays`).
- Hover intent: 350 ms delay → overlay with primary **Quick Play**, secondary **Host a Room**, tertiary small info affordance → game detail page (detail keeps rules/releases/creator + full Host dialog).
- Click on thumbnail or title (anywhere non-button on the capsule) = Quick Play immediately.
- Touch (no hover): tap = Quick Play; an explicit `⋯` affordance on the capsule opens the same actions (Host / Details). Keyboard: capsule focusable, Enter = Quick Play, menu key/long-focus shows actions (WCAG parity).

### 2. Quick Play semantics (join-or-create)
- `GET`-free flow: `POST /api/quickplay {slug}` → join the most-filled public room of that game's **latest release** with an open seat; if none, atomically create a **matchmade** room and join it. Race-safe via D1 conditional update + retry loop.
- Room origin field: `origin: "hosted" | "quickplay"`. Hosted-public still requires auth (PRD-ID-003 unchanged); quickplay rooms are platform-created (system actor), so guests can quick-play without an account. Both origins appear in the public rooms list; quickplay rooms carry no creator identity.
- Guests entering via Quick Play get an auto-generated display name (`Guest-XXXX`), no prompt (friction kill); invite-link joins keep the display-name step (SPEC 02.2). Rename-in-table is a follow-up.

### 3. Metrics
- **totalPlays** (per game): incremented once per (room, player) pair at first successful WS bootstrap in that room — guests count, spectators don't (MVP). Stored on `games`, incremented async/batched from the DO; approximate is acceptable, monotonic is required.
- **currentPlayers** (per game): sum of connected player counts across ACTIVE rooms, sourced from `rooms_index` rows the DO refreshes on join/leave/disconnect and on a coarse heartbeat; staleness tolerance ≤ ~60 s. Zero is shown as absence ("— playing" hidden), not "0 playing".

### 4. Cover images
- Built-in games: hand-crafted vector covers committed in-repo, served through the same cover endpoint for uniformity.
- Uploaded games: optional cover upload (`POST /api/games/:slug/cover`, owner-only) — PNG/JPEG/WebP, ≤ 512 KiB, dimensions parsed from headers (magic bytes + header dims; reject > 4096 px), stored as-is in R2 (`covers/<gameId>`), served at `GET /api/games/:slug/cover` with long immutable-ish cache + version query. No resize pipeline in MVP (documented budget instead). Games without covers get a deterministic generated placeholder (title + palette seeded from slug).

## Consequences
- `rooms_index` grows origin/player-count/heartbeat columns (migration), and the DO gets one more D1 write path (join/leave) — still no game-rule logic in the DO (ARCH-007 intact).
- Quick Play changes the primary funnel: capsule click → in a table within seconds, no interstitial. Game detail remains one hop away for deliberate hosting.
