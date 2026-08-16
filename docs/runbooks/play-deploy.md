# Runbook: play.digipology.com deployment

`play.digipology.com` is one Worker, `digipology-play` (ADR-0002 §1). It serves the built
`apps/web` SPA as static assets, the `/api/*` platform API, and the Room Durable Object
WebSocket path from a single origin. Config lives in `apps/worker/wrangler.jsonc`; nothing
about the deployment depends on dashboard clicks except where noted.

All commands run from `apps/worker/` unless stated otherwise, with a wrangler matching the
pinned devDependency (`bunx wrangler` resolves it). Auth comes from either `wrangler login`
or a `CLOUDFLARE_API_TOKEN` environment variable scoped to the account.

- Account: `0355a48bdcf68a5e308d3eb51082eafe`
- Zone: `digipology.com` (`1d5dc349556d92d34b29149f536a5bef`)
- Production URL: `https://play.digipology.com`
- Fallback URL: `https://digipology-play.sano.workers.dev` (`workers_dev: true`)

## Environment reference

Vars (committed in `wrangler.jsonc`):

| Name | Value | Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `https://play.digipology.com` | Absolute origin used in magic links and invite URLs |
| `EMAIL_FROM` | `noreply@digipology.com` | Sender address; domain must be onboarded to Email Sending |

Secrets (never committed; set with `wrangler secret put`):

| Name | Shape | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | ≥32 chars of high-entropy text (we use 32 random bytes hex-encoded) | HMAC key for session tokens and dev-token encryption |

Dev-only (uncommitted `.dev.vars`, never production):

| Name | Purpose |
| --- | --- |
| `EMAIL_DEV_MODE=true` | Switches to the logging email sender and enables `/api/dev/last-magic-link` |

Bindings: `DB` (D1 `digipology`), `ROOM` (Durable Object `RoomDO`), `EMAIL` (send_email),
plus the assets binding pointed at `../web/dist`.

## Full bring-up (from an empty account)

```sh
# 0. Toolchain: bun install at the repo root; bun test and bun run typecheck must be green.
cd apps/worker

# 1. D1 database (once per account)
bunx wrangler d1 create digipology
#    Copy the printed database_id into wrangler.jsonc -> d1_databases[0].database_id.

# 2. Migrations (idempotent; run on every schema change)
bunx wrangler d1 migrations apply digipology --remote

# 3. Session secret (once, then only on rotation)
#    Generate 32 random bytes hex OUT OF BAND and pipe it in; never echo it into logs.
bunx wrangler secret put SESSION_SECRET

# 4. Email sending for the zone (once per domain; open-beta wrangler commands)
bunx wrangler email sending enable digipology.com
bunx wrangler email sending dns get digipology.com   # verify records, see Email section

# 5. Build the SPA
cd ../web && bun run build

# 6. Deploy the worker (uploads assets, publishes the custom domain route)
cd ../worker && bunx wrangler deploy

# 7. Smoke against the live origin (repo root)
cd ../.. && bun scripts/smoke-play.ts https://play.digipology.com
```

The deploy prints the version ID; record it in the PR/issue alongside the smoke output.

## Migration procedure

- Migrations live in `apps/worker/migrations/` and are plain sequential SQL
  (`0001_platform_v1.sql`, ...). Add a new numbered file; never edit an applied one.
- Apply order: migrations first, deploy second — the worker at version N must work against
  schema N+1, so write additive migrations (new tables/columns with defaults) whenever
  possible.
- `bunx wrangler d1 migrations apply digipology --remote` applies anything unapplied and is
  safe to re-run. `--local` targets the local dev database used by `wrangler dev`.
- D1 keeps the applied list in its `d1_migrations` table; `bunx wrangler d1 migrations list
  digipology --remote` shows pending files.

## Secret rotation

```sh
bunx wrangler secret put SESSION_SECRET   # paste the new 32-byte hex value
```

Rotation takes effect on the next deployment wrangler performs for the secret change
(immediately — no separate deploy needed). Rotating `SESSION_SECRET` invalidates every
outstanding session cookie and any unconsumed dev-mode magic-link ciphertexts; users simply
sign in again. There is nothing else to rotate: room tokens are per-room random values
hashed in DO storage, not derived from the secret.

## Custom domain notes

- The route is declared in `wrangler.jsonc`:
  `"routes": [{ "pattern": "play.digipology.com", "custom_domain": true }]`.
  On deploy, Cloudflare creates the DNS record and certificate for the subdomain
  automatically; no manual DNS is needed for `play`.
- The apex `digipology.com` is a separate Worker (`digipology-site`, `apps/site`) with its
  own custom domain. Only the `play` subdomain belongs to `digipology-play`; do not touch
  apex records from this deployment.
- `workers_dev: true` keeps `https://digipology-play.sano.workers.dev` as a fallback origin.
  Magic links always point at `PUBLIC_ORIGIN`, so auth round-trips only work on the custom
  domain; the fallback is for triage, not for users.

## Email / DNS records

Email uses Cloudflare Email Service (Email Sending) with the `EMAIL` send_email binding
(ADR-0002 §2). `bunx wrangler email sending enable digipology.com` onboarded the zone and —
because the zone is on the same account — auto-created the required records:

| Type | Name | Content |
| --- | --- | --- |
| MX ×3 | `cf-bounce.digipology.com` | `route{1,2,3}.mx.cloudflare.net` |
| TXT | `cf-bounce.digipology.com` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf-bounce._domainkey.digipology.com` | DKIM public key (`v=DKIM1; ...`) |
| TXT | `_dmarc.digipology.com` | `v=DMARC1; p=reject;` |

Verify with `bunx wrangler email sending dns get digipology.com` (should list the same
records) and `bunx wrangler email sending list` (zone enabled: yes). Send failures are
logged by the worker as `magic-link email delivery failed` with an error code — check
`bunx wrangler tail digipology-play` while POSTing `/api/auth/request-link`.

The dev fallback sender is production-disabled: without `EMAIL_DEV_MODE=true`,
`/api/dev/last-magic-link` returns 404 and the real `EMAIL` binding is used.

## Smoke usage

```sh
bun scripts/smoke-play.ts https://play.digipology.com   # live
bun scripts/smoke-play.ts                               # local wrangler dev (127.0.0.1:8787)
bun scripts/smoke-zone-runner.ts https://play.digipology.com
SMOKE_SESSION=<cookie-token> bun scripts/smoke-saves.ts https://play.digipology.com
```

Covers: unauthenticated `/api/me`, catalog, SPA deep-link fallback, private room create,
guest join via a scrambled code, dual WebSocket handshakes, release-bundle snapshot load,
`entity.grab`/`entity.flip`/`entity.drop` plus a Dice Dash die roll with identical ordered
streams and converged kernel hashes on both clients, the public-rooms listing, and the
public-room auth gate. Prints PASS/FAIL per check and exits non-zero on failure. Optionally
set `SMOKE_SESSION` to a valid `dgp_session` cookie value to also exercise authenticated
public-room creation; without it, that check is skipped (creating a session requires a real
magic-link login, which cannot be automated in production by design).

`smoke-saves.ts` requires the value of an authenticated `dgp_session` cookie in
`SMOKE_SESSION`. It runs the two-client save/resume convergence scenario for both
unscripted First Deal and scripted Zone Runner v2, checks the sequence-zero rebase and
mid-grab release, verifies signed-out and non-host save authorization, then deletes its
saved-table rows. Omit the URL to target local `wrangler dev`.

## Rollback

Worker code/config:

```sh
bunx wrangler deployments list       # find the previous deployment and version ID
bunx wrangler rollback [version-id]  # omit the ID to be prompted with recent versions
```

Rollback swaps traffic to the old version's code, bindings, and assets. Secrets are
whatever the account currently holds — rolling back does not restore an old
`SESSION_SECRET`.

D1 caveats: migrations are not rolled back by `wrangler rollback`. There is no down
migration mechanism; the schema stays at the newest applied migration. Because migrations
are additive, old worker versions keep working against a newer schema. If a migration
itself must be undone, write and apply a new forward migration that reverses it, or restore
via `bunx wrangler d1 time-travel` (D1 keeps 30 days of point-in-time history) — restoring
loses writes made after the restore point, including rooms and sessions created since.

Asset-only problems (bad SPA build): rebuild `apps/web` at the last good commit and
redeploy; assets are content-addressed, so redeploying an identical build is a no-op.
