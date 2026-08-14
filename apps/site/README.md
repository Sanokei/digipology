# Digipology site

Static landing and documentation site for [digipology.com](https://digipology.com).

## Why Astro

Issue #8 prefers Astro, and it fits this site directly: content collections validate the documentation frontmatter, markdown pages become individual static HTML routes, and Astro ships no client framework runtime by default. The only browser JavaScript here is the small inline theme toggle. That keeps the landing page fast while leaving a straightforward home for the Lua API reference.

## Development

From the monorepo root, install workspace dependencies:

```sh
bun install
```

Then work inside `apps/site`:

```sh
bun run dev
bun run typecheck
bun test
bun run build
```

`bun run build` writes static files to `dist/` and then checks every internal page link and fragment in that output. Astro's content collection schema also makes a build fail when a docs file is missing either required frontmatter field:

```yaml
---
title: Page title
description: One-sentence page summary.
---
```

## Repository docs sync

The site uses a build-time sync because the repository-root `docs/` files remain useful on GitHub while the site needs a small, deterministic presentation transform. `bun run docs:sync` discovers Markdown recursively, validates its frontmatter, strips the source H1 already supplied by the site layout, rewrites links to published Markdown as `/docs/.../`, and sends links to internal repository material to GitHub. It writes ignored output under `src/content/docs/repository/`; generated files must not be edited.

This design makes `docs/` the single source of truth, removes checked-in copies, and leaves Astro's zod schema as a second build-time gate. A new publishable `docs/*.md` file needs only non-empty `title` and `description` frontmatter to gain a page and an alphabetically slotted navigation entry. No per-file registry is involved.

The explicit non-public list lives in `src/lib/docs-sync.ts`:

- `docs/adr/**`
- `docs/runbooks/**`
- `docs/spec/**`
- `docs/releasing.md`

Site-only reader guides such as Getting started and Architecture remain authored under `src/content/docs/`. The featured pages have an explicit narrative order; later synced pages are appended alphabetically until the navigation order is intentionally expanded.

## Cloudflare Workers static assets

`wrangler.jsonc` points Cloudflare Workers static assets at `dist/`, enables static 404 handling, and contains the prepared `digipology.com` Custom Domain route as commented JSONC. The route remains commented so a routine dry run cannot attach production DNS.

Validate the bundle without deploying:

```sh
bun run build
wrangler deploy --dry-run
```

For the later production cutover:

1. Add `digipology.com` to the target Cloudflare account as an active zone and delegate its authoritative nameservers to Cloudflare.
2. Remove any conflicting apex `A`, `AAAA`, or `CNAME` record intended to serve another origin.
3. Uncomment the `routes` array in `wrangler.jsonc` and set `workers_dev` to `false` if the preview hostname should be disabled.
4. Authenticate Wrangler to the correct account and run `wrangler deploy` from this directory.

The last command creates or updates external Cloudflare resources. It is documentation only for this issue; no production deploy or DNS cutover is performed here.

## Evidence for a pull request

Before opening the issue #8 pull request, capture Lighthouse mobile JSON or a screenshot for `/` and screenshots in light and dark themes at 360 px and 1440 px. Keep those review artifacts out of the production page unless the repository's contribution process specifies a location.
