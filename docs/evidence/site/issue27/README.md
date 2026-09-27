# Issue #27 — live-site evidence

Captured from **https://digipology.com/** on **2026-09-27 UTC**. These artifacts show the existing production site, including its old npm links. The source-link fix in this branch is **not deployed**. Prepared for coordinator review of #27 and cross-linking from PR #16; no issue comment, PR, push, or deployment was performed.

## Lighthouse mobile

[Open the full Lighthouse report](live-2026-09-27T05-45-40.196Z-lighthouse-mobile.html), fetched **2026-09-27T05:45:40.196Z**.

| Performance | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- |
| 100 | 100 | 96 | 100 |

Lighthouse 13.5.0, Chromium 153.0.8010.12, default mobile simulation (412 × 823, DPR 1.75, simulated throttling, CPU slowdown 4×). No runtime error or run warnings. Best Practices reports a 404 for `/favicon.ico`; it is retained as a live finding. One synthetic run is evidence for this capture, not a performance guarantee. [Machine-readable summary](lighthouse-summary.json).

## Live screenshots

Full-page JPEGs at quality 75, viewport height 900, DPR 1. Fresh browser contexts use the indicated `prefers-color-scheme`; no page styling or content was altered. Neither width had horizontal overflow. UTC capture time is included in each filename and [capture metadata](capture-metadata.json).

| Theme | Viewport width | Live capture (UTC) |
| --- | --- | --- |
| light | 360 | [2026-09-27T05:45:27.912Z](live-2026-09-27T05-45-27.912Z-light-360.jpg) |
| dark | 360 | [2026-09-27T05:45:28.943Z](live-2026-09-27T05-45-28.943Z-dark-360.jpg) |
| light | 1440 | [2026-09-27T05:45:29.927Z](live-2026-09-27T05-45-29.927Z-light-1440.jpg) |
| dark | 1440 | [2026-09-27T05:45:31.128Z](live-2026-09-27T05-45-31.128Z-dark-1440.jpg) |

## Package URL/status matrix

Checked **2026-09-27T05:44:31–05:44:33Z** with HTTP GET. npm website requests returned **403**, not a confirmed website 404; the authoritative npm registry returned **404 for all eight names**, so none was publicly available there. All replacement GitHub source destinations returned **200**. [Exact URLs, status codes, and timestamps](url-status.json).

| npm package URL | Website HTTP | Registry URL / HTTP | Replacement source / HTTP |
| --- | --- | --- | --- |
| [digipology-canonical-json](https://www.npmjs.com/package/digipology-canonical-json) | 403 | [registry](https://registry.npmjs.org/digipology-canonical-json) — 404 | [canonical-json](https://github.com/Sanokei/digipology/tree/main/packages/canonical-json) — 200 |
| [digipology-prng](https://www.npmjs.com/package/digipology-prng) | 403 | [registry](https://registry.npmjs.org/digipology-prng) — 404 | [prng](https://github.com/Sanokei/digipology/tree/main/packages/prng) — 200 |
| [digipology-kernel](https://www.npmjs.com/package/digipology-kernel) | 403 | [registry](https://registry.npmjs.org/digipology-kernel) — 404 | [kernel](https://github.com/Sanokei/digipology/tree/main/packages/kernel) — 200 |
| [digipology-protocol](https://www.npmjs.com/package/digipology-protocol) | 403 | [registry](https://registry.npmjs.org/digipology-protocol) — 404 | [protocol](https://github.com/Sanokei/digipology/tree/main/packages/protocol) — 200 |
| [digipology-lua](https://www.npmjs.com/package/digipology-lua) | 403 | [registry](https://registry.npmjs.org/digipology-lua) — 404 | [lua](https://github.com/Sanokei/digipology/tree/main/packages/lua) — 200 |
| [digipology-ai](https://www.npmjs.com/package/digipology-ai) | 403 | [registry](https://registry.npmjs.org/digipology-ai) — 404 | [ai](https://github.com/Sanokei/digipology/tree/main/packages/ai) — 200 |
| [digipology-covers](https://www.npmjs.com/package/digipology-covers) | 403 | [registry](https://registry.npmjs.org/digipology-covers) — 404 | [covers](https://github.com/Sanokei/digipology/tree/main/packages/covers) — 200 |
| [digipology-demo-games](https://www.npmjs.com/package/digipology-demo-games) | 403 | [registry](https://registry.npmjs.org/digipology-demo-games) — 404 | [demo-games](https://github.com/Sanokei/digipology/tree/main/packages/demo-games) — 200 |
| [Footer npm search](https://www.npmjs.com/search?q=digipology-) | 403 | N/A (search, not a package) | [Package source](https://github.com/Sanokei/digipology/tree/main/packages) — 200 |

The eight landing cards now point to source directories, with visible copy explaining pending npm publication. The shared footer says “Package source.” This keeps the packages useful to inspect without advertising unavailable downloads. Recheck publication before restoring npm links. The current getting-started article has no npm link in its body; its shared footer is covered by the layout fix. The built site's 17 HTML files contain no remaining npm anchors. [Live page inventory](live-npm-inventory.json) records the pre-fix URLs across deployed routes.

## Validation and reproduction

- `bun run --cwd apps/site build`: PASS, 17 pages; internal links pass.
- `bun run --cwd apps/site typecheck`: PASS, 0 errors/warnings/hints.
- `bun test apps/site/src`: PASS, 23 tests, 0 failures.
- Built HTML inspection: all eight source destinations rendered; no npm anchors or evidence routes across all 17 HTML files.
- Documentation sync excludes `docs/evidence/`, with a fixture proving that evidence without frontmatter does not enter published docs.

Tooling was installed only in ignored `apps/site/.cache/issue27/` (Playwright 1.63.0, Lighthouse 13.5.0); no project runtime dependency or root lockfile changed. Set `PLAYWRIGHT_BROWSERS_PATH` to that cache's `browsers` directory and `TMPDIR` to the cache when capturing. Screenshots use Playwright Chromium, `page.goto(..., {waitUntil: 'networkidle'})`, `document.fonts.ready`, and `page.screenshot({fullPage:true,type:'jpeg',quality:75})` in fresh 360/1440 × 900 contexts with light/dark `colorScheme`.

Lighthouse invocation (from worktree root):

```sh
TMPDIR="$PWD/apps/site/.cache/issue27" \
CHROME_PATH="$PWD/apps/site/.cache/issue27/browsers/chromium-1243/chrome-linux64/chrome" \
node apps/site/.cache/issue27/node_modules/lighthouse/cli/index.js \
  https://digipology.com/ --chrome-flags='--headless --no-sandbox' \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=html --output=json \
  --output-path="$PWD/apps/site/.cache/issue27/lighthouse-mobile" --quiet
```

The HTML report embeds its data; the duplicate full JSON and installed browser are kept out of Git. Logs are under `/srv/digipology/agents/issue27-{build,test,typecheck}.log`. Validation is site-scoped; monorepo-wide checks and publication are left to the coordinator.
