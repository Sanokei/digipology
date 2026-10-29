# Public game entry: identity and play in the first screen

Application source: [502bd124d33bb5dc9fd496c00c5774da36e121fd](https://github.com/Sanokei/digipology/commit/502bd124d33bb5dc9fd496c00c5774da36e121fd).
Base: fd26a3e9993a556232be3fb33af54f5bbaa07a53. The source was pushed on
`fix/game-entry-viewport` and normally fast-forwarded into `main`; both exact refs
were read back at the application source above. This QA-only commit directly
parents that application source and adds evidence, without changing application code.

The source-backed plan and final acceptance notes are in
[`docs/runbooks/game-detail-entry.md`](../../docs/runbooks/game-detail-entry.md).
The previous editor checkpoint and its exact scopes remain at
[e66a2e836dbd1746cd29566cd1c42103bf067e17](https://github.com/Sanokei/digipology/tree/e66a2e836dbd1746cd29566cd1c42103bf067e17/qa/fd26a3e9993a-editor-handoff).

## Before and after

Every PNG is the unchanged browser capture; no crops, compositing or image edits.
They are viewport captures, not full-page images. All `after/` frames come from
one fresh six-scenario run on the final application source. They were visually
reviewed. JSON companions record actual element bounds and viewport dimensions.

| Case | Before | Current |
| --- | --- | --- |
| Desktop portrait | [before](before/portrait-desktop.png) | [current](after/portrait-desktop.png) |
| 390×844 public entry | [before](before/portrait-390.png) | [current](after/portrait-390.png) |
| 390×480 entry | — | [current](after/portrait-short.png) |
| Long title, no image, 390×844 | — | [current](after/long-title-no-cover-390.png) |
| Maximum 80-character title, 390×480 | — | [current](after/long-title-no-cover-short.png) |
| Maximum title with portrait, 390×480 | — | [current](after/long-title-portrait-short.png) |
| Landscape response, 390×844 | — | [layout fixture](after/landscape-390.png) |
| Landscape response, desktop | — | [layout fixture](after/landscape-desktop.png) |
| Missing cover response | — | [entry remains usable](after/failed-cover-390.png) |
| Actual image after retry | — | [recovered](after/recovered-cover-390.png) |
| Credits and downloads after scrolling | — | [current](after/portrait-credits-390.png) |
| Selected unlisted game, catalog unavailable | — | [host](after/selected-host-390.png) |
| Short host dialog | [covered Close / offscreen Create](intermediate/host-short-covered.png) | [current](after/host-short-ready.png) |
| Separate sign-in overlay, short height | — | [current](after/host-sign-in-short.png) |
| Selected game's table, renderer ready | — | [host](after/selected-table-390.png) |
| Second guest from actual invite, renderer ready | — | [guest](after/invited-table-390.png) |

The base's new regression intentionally exits 1: the title starts at y=921.4 and
Play or host at y=1263.4 in a 390×844 viewport. The final title is at y=205.7–272.9
and action at y=324.9–372.9. At 390×480 the 80-character title and primary action
remain fully visible (action y=380.7–428.7), with no horizontal overflow.
The intermediate short-host image is explicitly an uncommitted failing iteration
based on fd26a3e, before the final host CSS; it is not a source-pinned passing frame.

The title/player range/action now precede artwork in reading and keyboard order.
Desktop keeps artwork on the left; mobile uses a bounded, contained preview.
View full artwork opens the versioned original image, and both original download
and credit-package actions remain accessible. Play or host opens the existing
dialog with this game selected, including direct unlisted entry and a failed
catalog fetch. The host dialog sits above the header with usable short-height
controls, focus wrap/restore, resize and separate sign-in dismissal.

## Verification and provenance

`checks/browser-command.json` is the captured child command receipt: exit 0.
`checks/browser-summary.json` has six expected, zero skipped/unexpected/flaky,
and no reporter errors. Three scenarios cover detail entry and three are the
unchanged homepage host-dialog regressions. Web build/types, E2E types, the host
gating unit test (one pass), chunk boundaries and the frozen-fixture guard pass.
No unrelated full 18-case/860-test cycle was repeated for this focused change.

The normal APIs publish/upload the existing accepted local raster draft in
`e2e/fixtures/raster-draft.editor.json` into isolated local D1/R2 storage. It is
test metadata on a saved fixture, not new showcase content or live generation.
Actual original-image opening, raw download, credit-package download, catalog
failure, unlisted selection, table creation and a second guest joining its
invite run through browser/Worker/runtime paths. Both table captures await
renderer-ready and the absence of the loading overlay. The test verifies the
selected game's title and two players; these screenshots do not prove fun,
balance, sound quality or hidden-information secrecy.

The landscape image is a controlled response of existing repository artwork
(`tabletop-world.webp`, 1672×941) to stress layout. The actual upload API accepts
portraits, and no landscape upload or changed storage format is claimed. The
missing image is also a controlled response, then removed for a real server
reload. The failure alert is below the entry viewport; the tested title and
Play or host remain available. Existing attribution is intentionally unchanged
through these layout-only response fixtures.

The exact original download is `after/original-cover.webp`; its SHA-256 is
7e2c3f7ec1366c6e89f4d035c33604f3939b35d3aad66ece4f2f3ccb30522bd0.
`after/original.artwork.json` preserves the full image and credits.
`after/original-integrity.json` records cover version 1, matching attribution,
byte-identical download and the actual hosted slug. The API version/credit
checks after hosting pass. No asset bytes, image/credit versions, immutable
release content, kernel or replay fixture changed.

The first five-case after run passed four cases but rejected our over-limit test
title with HTTP 422 before reaching that layout; the title was corrected to the
actual accepted 80-character maximum. The next five passed. A manual short-host
check then found the covered Close/offscreen Create defect retained above, which
the final fresh six-case run closes. Raw auth logs/traces remain outside Git.
The historical two-case tool-exit anomaly and separate critical-alert receipt in
pack bebeab5405e0b85e3697cd25ccbf190591663109 remain unchanged; this is not a new
failure or a reinterpretation of that historical run.

## Unfinished gates

This is local runtime/source verification, not a deployment or remote CI claim.
There is no supported public app-preview exposure URL in this environment.
The cloud environment draft still needs review/save and Publish in Environment
settings; a saved draft does not apply network policy. Production migration
0008/deployment, live provider endpoint/model/key, genuine one-prompt strategy
and fun acceptance, and unattended Actions key/permissions/execution remain
pending or unverified. No providers, secrets, new game/media types, scheduled
jobs, network bypass or production operations were added.
