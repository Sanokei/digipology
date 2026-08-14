# ADR-0004: Guest parity, Kino play UI, DeepSeek harness, KitClay editor transplant

Status: Accepted · Date: 2026-08-14

## Context

Owner direction: (1) mirror kinoinstrument's logged-out model — "you can do everything that doesn't require an account"; (2) play.digipology.com's UI copies play.kinoinstrument.com; (3) thumbnails are generated, user picks from options ("packaging harness"); (4) a DeepSeek v4 Flash harness creates and edits games; (5) the game editor transplants from KitClay. Recon reports on both codebases inform every decision here.

## Decisions

### 1. Guest access — kino's *studio* posture

- **No auth middleware, no route guards.** The app holds `user: User | null`; views receive the nullable user plus `onSignIn` callbacks. Boot without a session renders the app logged-out — never a login screen.
- **Auth is an overlay, not a page.** `/login` stays deep-linkable but renders as a modal over whatever view is active; closing restores the prior URL.
- **Affordances are never hidden or disabled for guests.** Gated actions (upload/publish a game, set a game public, create a *hosted* public room, My Games persistence) show the real UI and fire an inline sign-in prompt on activation — the kino `if (!user) { onSignIn(); return; }` pattern at the action site.
- **Guest device identity**: `dgp.device.id` — `crypto.randomUUID()` persisted to localStorage **and** a 5-year cookie, each reseeding the other (kino `identity.ts` pattern). Used for per-device rate limits and future guest-draft cloud backup; never an authz credential.
- Server side keeps the existing split: `getAuthedUser` (nullable) vs `requireUser` (throws 401 Response). Suspension returns null (sessions just stop working).
- Already-guest-open flows stay: quick play, join by code, private room creation, spectating, browsing.

### 2. Play UI — transplant of play.kinoinstrument.com

- **Dark TV-app regardless of site theme.** Tokens (renamed `--dgp-*`, values verbatim from kino play.css): bg `#0b0b0f`, surface `#16161c`, text `#f3f3f5`, muted `#a1a1aa`, border `#26262e`, accent amber `#f3a53b` (text-on-amber `#17130a`). Inter UI stack, heavy weights (900 hero, 800 sections/CTAs, 600 card titles), 4px spacing grid, radii 8/10/12/14/16/18/999.
- **Layout = hero + horizontal rails** (Netflix), not a flat grid: full-bleed hero (`min(56vh,460px)`, two-layer scrim, amber eyebrow, clamp() 900-weight title, 3-line description, amber CTA) then one rail per category (Featured / Most played / New). Rails: flex tracks, `overflow-x auto`, chevron gradient-scrim pagers revealed on hover/focus, `scrollBy 0.85 * clientWidth`. Page never scrolls horizontally.
- **Capsule = 2:3 portrait poster** (168px desktop / 132px mobile — supersedes ADR-0003's 16:9; cover pipeline targets 336×504), whole card is a `<button>`. Structure: poster (radius 12, badge pill top-right) + meta (title 14/600 ellipsis, desc 12 hidden until hover).
- **Hover**: `translateY(-4px)` + shadow deepen (0.14s), description reveal via max-height/opacity (0.18s); every hover state mirrored on `:focus-visible`; full `prefers-reduced-motion` block; skeleton-shimmer loading at real dimensions (`aria-busy`), calm degraded states (retry card, never an error page).
- **ADR-0003 quick actions retained on top**: 350 ms hover-intent overlay with primary Quick Play, secondary Host a Room, small info→detail; click on poster/title = quick play; touch tap = quick play with a `⋯` action sheet; Enter on focused capsule = quick play.
- **Metrics on capsule**: badge/meta show live "n playing" (green dot, hidden at 0) + compact total plays. Coverless games get kino's deterministic id→hue two-stop gradient with centered title.
- Sub-view contract: fixed props shape + imperative nav object (kino `playNav.ts` pattern) so views never edit the shell.

### 3. DeepSeek harness — package `digipology-ai` (`packages/ai`)

Port of kino's proven core (owner's own code), adapted:
- **Transport port**: `deepseekFetch(payload, timeoutMs) → data | null` — `null` for keyless/timeout/non-2xx/unparseable; callers have exactly one branch. Key: `DEEPSEEK_API_KEY` Worker secret (never in vars/client); base `https://api.deepseek.com`; default model var `DEEPSEEK_MODEL` = `deepseek-v4-flash` (per owner; ijester ships this id in production), per-feature overrides allowed.
- **Structured output = forced function tool calls** (`tool_choice: {function}`), never `response_format`. `additionalProperties:false` + `required` + enums.
- **Extraction ladder** (v4-flash leaks DSML control tokens ~1-in-4): parse each `tool_calls[].function.arguments` → joined+artifact-stripped (`stripModelArtifacts` fullwidth-bar regex) → truncation salvage (`salvageTruncatedJson`) → `{…}` slice from content → `null` ⇒ deterministic fallback. Normalize every extracted payload (clamp strings, validate enums/hex) — never trust it.
- **Validator-feedback retry loop** (bundle generation): rejected output goes back as an assistant turn + typed violations user turn, ≤3 attempts, unparseable resets feedback, telemetry `{attempts, firstTryValid, retries, fallback, violations}` recorded.
- **Budgets**: per-user daily USD cap (`deepseek_usage(user_id, day, usd)` D1 table, conservative published pricing, record-before-parse) returning 429 `ai_daily_cap`; global daily cap via pessimistic reserve→fetch→reconcile (failed call's reservation stands); caps + keyless behave identically (degraded ≠ broken; deterministic path always wired and tested).

### 4. AI game creation/editing + packaging harness

- `POST /api/ai/games {prompt}` (auth): DeepSeek → bundle draft via forced tool call → run through the existing 8-check upload validation → violations fed back (loop above) → returns draft bundle + validation report; user lands in the editor/create flow with the draft, publishes via the normal upload path. `POST /api/ai/games/:slug/edit {instruction, bundle}` mirrors it for edits.
- **Packaging (covers)**: DeepSeek does *not* emit raw SVG. It emits a constrained **CoverSpec** (palette hexes, layout enum, motif enums, title treatment) via forced tool; a deterministic renderer in `packages/covers` turns CoverSpec → SVG → client-side raster (336×504 PNG) for upload through the existing cover endpoint. Generate 4 candidates, user picks (regenerate allowed); keyless fallback = seeded procedural CoverSpecs. Builtin games get committed CoverSpecs through the same renderer.

### 5. Editor — KitClay transplant (adapted, not verbatim)

- **Tier A adoptions**: `EditorStore` command/undo/autosave machinery (`applySceneCommand`, coalesced commands, useSyncExternalStore snapshotting); FlexLayout panel registry + persisted layouts + lazy panels with skeletons; panel primitives (NumberInput drag-scrub, CommitTextInput, color inputs), generic Tree with keyboard nav, context menus, declarative MenuBar + fuzzy command palette; CodeMirror 6 Lua IDE (legacy-mode Lua, stylua-wasm format-on-save, snippets) with completion/hover driven from **our** generated Lua API docs (single source, not a hand map); console/history panels; thumbnail bake queue.
- **Adaptations**: entity model = Digipology bundle format (explicit position/rotation/scale — no matrix decompose); history = deep-clone frames MVP (KitClay shape) with a patch-frame follow-up; scripts project-scoped; persistence = localStorage drafts + export/import + publish via upload API (no hardcoded cloud sync); playtest = run the draft bundle through the real kernel + Lua sandbox in-tab — **true isolation for free** (Stop discards runtime state; authored draft untouched), transport buttons drive kernel ticks, not rAF.
- **Not transplanted**: 5.5k-line viewport god-component (we render via our existing Babylon table scene), SDF stack, Blockly (Behavior Builder remains the locked no-code plan), Monaco/yjs dead scaffolding.
- Lives at `play.digipology.com/edit/:draftId` as a lazy chunk (desktop-only per spec PRD-MOB-003).

## Rollout

Wave 5: #43/#44 (amended: kino UI + guest parity). Wave 6: `packages/ai` + `packages/covers` + AI endpoints + cover picker. Wave 7: editor transplant (shell/store → Lua IDE/playtest → AI-assist integration).

## Consequences
- Play surface diverges visually from digipology.com (deliberate: TV-app dark vs editorial site).
- ADR-0003 amended: covers are 2:3 portrait; capsule labels unchanged.
- All AI features run with defined keyless/capped fallbacks, so the platform never depends on the key to function.
