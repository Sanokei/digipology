# Merlin Economics: all seven linked catalogs in the real source packet

Application/source tip **`e47ea33ffb3af17bd226a8abf256e7d258a41163`**, directly based on `c2f78ea76a4ff2570af01c40c911736bef72db80`. This QA-only commit directly parents that source; every path has a manifest hash and scope. The source changes are benchmark tooling, a real-source browser case and its runbook. The app/Worker/protocol/gameplay production source is unchanged from the preceding game-directed-artwork milestone.

## Actual outcome

All seven original linked Google Sheets are now readable. Their complete original XLSX exports each contain one worksheet; all seven ordinary CSV exports returned HTTP200. Exact source URLs, retrieval times, sizes, workbook/CSV hashes and single-tab coverage are in `source/`. No alternate host/proxy, credentials or account provisioning was used. This closes the earlier source-access blocker; saving/publishing a particular environment draft is not inferred from HTTP access.

The normal prepared request now includes the exact pinned **65,874-byte v0.1.27b rulebook** plus **33,777 bytes of seven complete CSVs**: **8 documents /99,651 bytes**. The existing8-file/128KiB app input needs no expansion or truncation. Every raw CSV is checked against the captured length/SHA-256 before output. Missing/changed source files fail. Quoted commas/escaped quotes, multiline cells, CRLF/BOM, zero-copy entries and trailing records survive; analysis never rewrites the attached text. Full author-owned rulebook/CSV/request contents are deliberately excluded from this public pack.

The **actual normal development app8787**, using its existing account/config and no model fixture, received all8 documents through Chromium sign-in and the ordinary Create form/API. It returned **503 / ai_unconfigured**, retained the exact request and returned no game. `actual-app/attempt.json` records every source hash and this result. This is distinct from the intentionally unconfigured isolated benchmark and from a fixture provider. No genuine generation, playable Merlin output, card-art fidelity, balance or fun is claimed.

## Source gaps were recorded, not invented away

| Catalog | Definitions | Declared copies | Listed copies |
| --- | ---: | ---: | ---: |
| Golems |8|Not declared as a total|Not inferred|
| Royal Guards |4|Not declared as a total|Not inferred|
| Tea Leaves |12|30|**42**|
| Crystal Ball |26|51|**52**|
| Spells |17|62|62|
| Potions |7|28|28|
| Royal Decrees |14|Not declared as a total|Not inferred|

Crystal Ball's original workbook A2 formula is `SUM(A$4:A$999)`, omitting its first listed count at A3. Tea Leaves' declared30 remains unchanged despite42 listed copies. Spells retains zero-copy Transmutation. The full Potions CSV has526 records (including trailing/ingredient data), not only seven extracted card rows. Some forecast effects use examples, unspecified amounts or a “specific threshold”; these do not establish executable values. Missing general Taxes/Indicators/Bankruptcy sections, ties/rounding and exact climate/season details remain gaps. The instruction and acceptance receipt explicitly retain the inconsistencies and incomplete-game label rather than choosing rules silently.

The repository Cards.sheet remains a partial historical copy (13 spells/48, no Tea Leaves, one zero-count Crystal Ball entry). The newly read original Sheets are a different captured source set, with exact dated hashes rather than an asserted version history. Update the captured manifest deliberately if the live Sheets change. Author credit is SidewaysTurtle/Kei Sano, All Rights Reserved in the provided rulebook; no CC0 redistribution claim is made.

## Focused checks

- Three parser/admission tests pass: quoted/multiline/BOM/CRLF handling, distinct declared/listed/zero-copy analysis, and missing/changed file refusal.
- Scripts/E2E type checks pass. The normal CLI prepares all8 exact sources and their metadata; the retained legacy2-argument command prepares an explicitly incomplete rulebook-only packet.
- One complete real-source browser scenario passes: **1 expected,0 skipped/unexpected/flaky/errors, child exit0**. Normal form/file selection and all8 source URLs/fingerprints, invalid and ninth-file atomic rejection, desktop/390px/short eighth-field visibility, actual unconfigured-server response, unchanged retry, keyboard download and zero accepted/published substitutes. Its full downloaded request remains private; hashes/receipts and original captures are shared.
- Site build/internal link check and frozen replay check pass. No app build or unrelated full unit/browser suite was repeated: runtime/frontend production files did not change. Prior artwork/runtime checks stay pinned at their original scopes.

No browser/test remains active. The ordinary development app/quality services are local-only; no supported public app-preview URL or production deployment was created. The earlier local empty Wrangler exit1 and all prior failures remain retained in the preceding pack, not rewritten as successes or newly attributed to this source-only change.

## Preserved artwork milestone and next gap

The [game-directed raster artwork pack](https://github.com/Sanokei/digipology/tree/e76a685ad65c829f7a03242fae9dd6c4fac85db4/qa/c2f78ea76a4f-game-directed-artwork) directly parents c2f78ea. It includes current Core/Lite, desktop/phone/short, per-game direction, original/processed hashes, private hand preservation, normal publication/reload and provider/decode/storage/lost-reply recovery. Busy sample-cover pictures are explicitly rejected as final art; they were controlled technical fixtures. Actual image access on the normal app returns503 artwork_unconfigured. Production custom card fronts and distinct per-deck artwork remain unfinished, alongside faithful real Merlin generation/play/repair and perceptual fun/sound QA.

Read `plans/merlin-economics.md` and the pinned helpers for reproduction. Set an existing authorized text/image endpoint/model/key through the normal account/environment configuration before live generation; no new secret/provider purchase was made here. Production migration0008/deployment and verified unattended Actions remain pending. Preserve pinned releases/canonical state and the existing schedule; do not duplicate automation. Raw auth/server/debug logs, sessions, traces, full private input and original copyrighted workbook contents are excluded.
